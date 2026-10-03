import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import ts from 'typescript';
import express from 'express';
import net from 'node:net';
import crypto from 'node:crypto';

// Mount the current production route and limiter, with only Firebase storage/auth replaced.
const sourceText = readFileSync('server.ts', 'utf8');
const source = ts.createSourceFile('server.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) &&
  ['getTrustedClientIp', 'checkRateLimit'].includes(n.name?.text || '')).map(n => n.getText(source).replace(/^export /, ''));
let route = '';
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.post' && n.arguments[0]?.getText(source) === "'/api/report-error'") route = n.getText(source);
  ts.forEachChild(n, visit);
}
visit(source); assert.ok(route);
const app = express(), reports: any[] = [], storage = new Map<string, any>();
const db = { collection: () => ({ doc: (id: string) => id }), runTransaction: async (fn: any) => fn({
  get: async (id: string) => ({ data: () => storage.get(id) }), set: (id: string, data: any) => storage.set(id, data)
}) };
const code = (await transform(`${functions.join('\n')}\n${route};\nglobalThis.clientIp = getTrustedClientIp;`, { loader: 'ts' })).code;
const env: any = { app, net, crypto, getAdminFirestore: () => db, jsonParser4kb: express.json({ limit: '4kb' }),
  getAuth: () => ({ verifyIdToken: async () => { throw new Error('invalid token'); } }),
  console: { warn: (report: string) => reports.push(JSON.parse(report)) } };
runInNewContext(code, env);
for (const spoofed of ['8.8.8.8', '1.1.1.1, 9.9.9.9', 'garbage']) {
  assert.equal(env.clientIp({ headers: { 'x-forwarded-for': spoofed }, socket: { remoteAddress: '127.0.0.1' }, ip: spoofed }), '127.0.0.1');
}
assert.equal(env.clientIp({ headers: { 'x-forwarded-for': '8.8.8.8' }, socket: {}, ip: '8.8.8.8' }), 'unknown');
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.status || 500).json({ error: 'Rejected' }));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const address = server.address() as net.AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/report-error`;
  for (let i = 0; i < 10; i++) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Forwarded-For': `8.8.8.${i}`, Authorization: 'Bearer invalid' },
      body: JSON.stringify({ message: 'Listener failed\nfor /feeds/calendars/user_secret.ics', source: 'TaskProvider.listener.tasks' }) });
    assert.equal(response.status, 200);
  }
  const limited = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '1.1.1.1' }, body: '{}' });
  assert.equal(limited.status, 429, 'Rotating forwarded headers cannot bypass the limit');
  assert.equal(reports.length, 10); assert.ok(reports.every(r => r.source === 'TaskProvider.listener.tasks'));
  assert.ok(reports.every(r => !r.message.includes('\n') && !r.message.includes('user_secret')));
  storage.clear();
  const oversized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(4096) }) });
  assert.equal(oversized.status, 413); assert.equal(reports.length, 10, 'Oversized bodies never produce logs');
} finally {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
console.log('Telemetry HTTP checks passed: spoofed forwarding, invalid tokens, strict shared limits, 4 KB cap and sanitized source-tagged logs.');
