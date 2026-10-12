import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const publicKey = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8')).apiKey;
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/],
  ['aws-key', /\bAKIA[A-Z0-9]{16}\b/],
  ['google-private-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['service-account-json', /"type"\s*:\s*"service_account"[\s\S]{0,500}"private_key"\s*:\s*"(?!\s*")/],
];
const hits = [];
function check(content, location) {
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (kind === 'google-private-key') {
      if ([...content.matchAll(pattern)].some(match => match[0] !== publicKey)) hits.push({ kind, location });
    } else if (pattern.test(content)) hits.push({ kind, location });
  }
}
const mode = process.argv[2] || 'current';
let examined = 0;
if (mode === 'history') {
  const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { encoding: 'utf8', maxBuffer: 32e6 }).trim().split('\n');
  for (const line of objects) {
    const [sha, ...path] = line.split(' ');
    if (!path.length || execFileSync('git', ['cat-file', '-t', sha], { encoding: 'utf8' }).trim() !== 'blob') continue;
    const content = execFileSync('git', ['cat-file', '-p', sha], { maxBuffer: 32e6 }).toString('utf8');
    check(content, `${sha}:${path.join(' ')}`); examined++;
  }
} else {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n');
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
  for (const directory of ['dist', 'build']) if (fs.existsSync(directory)) files.push(...walk(directory));
  for (const file of new Set(files)) { if (fs.existsSync(file) && fs.statSync(file).isFile()) { check(fs.readFileSync(file, 'utf8'), file); examined++; } }
}
const result = { mode, examined, findings: hits, note: 'High-confidence pattern scan; Firebase public app key is explicitly excluded. Values are never emitted.' };
console.log(JSON.stringify(result, null, 2));
process.exitCode = hits.length ? 1 : 0;
