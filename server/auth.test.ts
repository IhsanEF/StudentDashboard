import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import ts from 'typescript';
import express from 'express';
import helmet from 'helmet';
import { isAiBillingUnavailable } from './lib';
import type { AddressInfo } from 'node:net';

// Exercise the actual production middleware with Firebase token verification mocked.
const sourceText = readFileSync('server.ts', 'utf8');
const source = ts.createSourceFile('server.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const authCode = source.statements.filter(n => ts.isVariableStatement(n) &&
  n.declarationList.declarations.some(d => ['requireAuth', 'requireFreshAuth'].includes(d.name.getText(source))))
  .map(n => n.getText(source)).join('\n');
let security = '';
let retiredFeedRoute = '';
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.use' &&
    n.arguments[0]?.getText(source).startsWith('helmet(')) security = n.getText(source);
  if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.post' &&
    n.arguments[0]?.getText(source) === "'/api/parse/ics'") retiredFeedRoute = n.getText(source);
  ts.forEachChild(n, visit);
}
visit(source);
assert.ok(authCode && security && retiredFeedRoute);
const app = express();
const verifications: any[] = [];
let token: any = {};
let invalidToken = false;
const code = await transform(`${authCode}\n${security};\n${retiredFeedRoute};\napp.get('/normal', requireAuth, (_req, res) => res.sendStatus(204));
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
  const retired = await fetch(origin + '/api/parse/ics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/private' }) });
  assert.equal(retired.status, 410);
  assert.match((await retired.json()).error, /removed/i);
  assert.equal(verifications.length, 0, 'Retired feed route never connects to Firebase or a remote feed');
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

const generator = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'generateGeminiContentWithFallback');
assert.ok(generator);
const generatorEnv: any = { isAiBillingUnavailable, console: { warn() {} } };
runInNewContext((await transform(`${generator.getText(source)}; globalThis.generate = generateGeminiContentWithFallback;`, { loader: 'ts' })).code, generatorEnv);
let generationCalls = 0;
const billingError = { status: 402, message: 'Your prepayment credits are depleted.' };
await assert.rejects(generatorEnv.generate({ models: { generateContent: async () => { generationCalls++; throw billingError; } } }, {}, 'test-slot'), error => error === billingError);
assert.equal(generationCalls, 1, 'Changing models cannot fix depleted billing credits');
console.log('AI billing failures stop model retries.');
