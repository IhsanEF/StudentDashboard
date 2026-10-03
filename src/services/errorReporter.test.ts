import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const bundle = await build({ entryPoints: ['src/services/errorReporter.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'auth', setup(b) {
    b.onResolve({ filter: /\/auth$/ }, () => ({ path: 'auth', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const auth=globalThis.auth;' }));
  } }] });
const sent: Array<{ body: string; headers: Record<string, string> }> = [];
const module = { exports: {} as any };
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, TextEncoder, console,
  navigator: { userAgent: 'browser' }, auth: { currentUser: { getIdToken: async () => 'verified-token' } },
  fetch: async (url: string, options: any) => { assert.equal(url, '/api/report-error'); sent.push(options); } });
const report = module.exports.reportError;
const failure = { message: 'Listener failed for student@example.com /feeds/calendars/user_secret-token_123.ics', stack: '火'.repeat(5000) };
report(failure, { source: 'TaskProvider.listener.tasks', componentStack: '火'.repeat(5000) });
report(failure, { source: 'TaskProvider.listener.tasks' });
report(failure, { source: 'TaskProvider.listener.courses' });
await new Promise<void>(resolve => setImmediate(resolve));
assert.equal(sent.length, 2, 'Identical reports dedupe per source, without hiding a different dead listener');
for (const request of sent) {
  assert.ok(Buffer.byteLength(request.body, 'utf8') <= 4096, 'Multibyte payload fits the server cap');
  assert.equal(request.headers.Authorization, 'Bearer verified-token');
  const payload = JSON.parse(request.body);
  assert.ok(payload.source.startsWith('TaskProvider.listener.'));
  assert.ok(!payload.message.includes('student@example.com') && !payload.message.includes('secret-token_123'));
}
console.log('Client telemetry source dedupe, UTF-8 body cap, bearer header and redaction passed.');
