import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import ts from 'typescript';
import express from 'express';
import helmet from 'helmet';
import type { AddressInfo } from 'node:net';

// Exercise the actual production middleware with Firebase token verification mocked.
const sourceText = readFileSync('server.ts', 'utf8');
const source = ts.createSourceFile('server.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const authCode = source.statements.filter(n => ts.isVariableStatement(n) &&
  n.declarationList.declarations.some(d => ['requireAuth', 'requireFreshAuth'].includes(d.name.getText(source))))
  .map(n => n.getText(source)).join('\n');
let security = '';
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.use' &&
    n.arguments[0]?.getText(source).startsWith('helmet(')) security = n.getText(source);
  ts.forEachChild(n, visit);
}
visit(source);
assert.ok(authCode && security);
const app = express();
const verifications: any[] = [];
let token: any = {};
let invalidToken = false;
const code = await transform(`${authCode}\n${security};\napp.get('/normal', requireAuth, (_req, res) => res.sendStatus(204));
app.get('/fresh', requireFreshAuth, (_req, res) => res.sendStatus(204));`, { loader: 'ts' });
runInNewContext(code.code, {
  app, helmet, process: { env: { NODE_ENV: 'production' } }, console: { error() {} },
  getAuth: () => ({ verifyIdToken: async (...args: any[]) => {
    verifications.push(args);
    if (invalidToken) throw { code: 'auth/id-token-revoked', message: 'revoked' };
    return token;
  } })
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const route of ['/normal', '/fresh']) {
    assert.equal((await fetch(origin + route)).status, 401);
    for (const provider of ['google.com', 'password', 'anonymous', 'custom', undefined]) {
      for (const verified of [true, false]) {
        token = { uid: 'existing-user', firebase: { sign_in_provider: provider }, email_verified: verified };
        const response = await fetch(origin + route, { headers: { Authorization: 'Bearer test-token' } });
        assert.equal(response.status, verified && ['google.com', 'password'].includes(provider!) ? 204 : 403);
        const csp = response.headers.get('content-security-policy')!;
        assert.match(csp, /script-src 'self' https:\/\/apis.google.com https:\/\/www.gstatic.com/);
        assert.doesNotMatch(csp.split(';').find(d => d.startsWith('script-src '))!, /unsafe-inline|unsafe-eval/);
        assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
      }
    }
    invalidToken = true;
    assert.equal((await fetch(origin + route, { headers: { Authorization: 'Bearer revoked' } })).status, 401);
    invalidToken = false;
  }
  assert.ok(verifications.every(call => call[1] === true), 'Every protected route still checks revocation');
} finally {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
console.log('Auth HTTP: verified Google/password accepted, other providers/unverified/revoked tokens rejected, popup CSP allowed.');
