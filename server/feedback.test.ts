import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { mountFeedbackRoutes, sweepExpiredFeedback } from './feedback';

// Exercise real HTTP parsing/routes; replace only account verification and storage.
const records = new Map<string, any>();
let unavailable = false, quota = true, quotaCalls = 0;
let serial = Promise.resolve();
const snapshot = (id: string) => ({ exists: records.has(id), data: () => records.get(id), ref: { id } });
const collection = {
  doc: (id: string) => ({ id, get: async () => { if (unavailable) throw Error('private storage detail'); return snapshot(id); } }),
  where: (field: string, operator: string, now: Date) => {
    assert.equal(field, 'expiresAt'); assert.equal(operator, '<=');
    return { limit: (limit: number) => ({ get: async () => {
      assert.equal(limit, 100);
      const docs = [...records].filter(([, value]) => value.expiresAt <= now).slice(0, limit).map(([id]) => snapshot(id));
      return { empty: !docs.length, docs };
    } }) };
  }
};
const db = {
  collection: (name: string) => { assert.equal(name, 'feedback_submissions'); return collection; },
  runTransaction: (callback: any) => {
    const result = serial.then(() => callback({ get: async (ref: any) => snapshot(ref.id), set: (ref: any, value: any) => records.set(ref.id, value) }));
    serial = result.then(() => undefined); return result;
  },
  batch: () => { const ids: string[] = []; return { delete: (ref: any) => ids.push(ref.id), commit: async () => ids.forEach(id => records.delete(id)) }; }
} as unknown as Firestore;
const app = express();
mountFeedbackRoutes(app, {
  authenticate: (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) { res.status(401).json({ error: 'Sign in' }); return; }
    (req as any).user = { uid: token, isDemo: token === 'demo' }; next();
  }, db: () => db,
  rateLimit: async (key, limit, windowMs) => { assert.ok(key.startsWith('feedback_')); assert.equal(limit, 5); assert.equal(windowMs, 3600000); quotaCalls++; return quota; }
});
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ error: 'Rejected' }));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const logs: string[] = [], info = console.info, warn = console.warn;
console.info = console.warn = (message: string) => { logs.push(message); };
try {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/feedback`;
  const payload = (extra: Record<string, unknown> = {}) => ({ requestId: crypto.randomUUID(), category: 'bug', message: 'The timetable button stopped responding.', steps: 'Opened Timetable.', severity: 'high', ...extra });
  const send = (body: any, user: string | null = 'account-a') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: user } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send(payload(), null)).status, 401);
  assert.equal((await send(payload(), 'demo')).status, 403);
  for (const extra of [{ uid: 'someone-else' }, { status: 'resolved' }, { message: 'tiny' }, { category: 'invalid' }, { context: { section: 'Overview', browser: 'Chrome', url: 'private' } }, { context: { section: 'Private course title', browser: 'Chrome' } }]) {
    assert.equal((await send(payload(extra))).status, 400);
  }
  assert.equal((await send(payload({ message: 'x'.repeat(25000) }))).status, 413);
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'account-a' }, body: '{"message":"private malformed draft"' });
  assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes('private malformed draft'));
  assert.equal(records.size, 0); assert.equal(quotaCalls, 0);
  const body = payload(), first = await send(body);
  assert.equal(first.status, 201); const receipt = await first.json();
  const stored = records.get(receipt.id);
  assert.equal(stored.status, 'new'); assert.equal(stored.message, body.message);
  assert.equal(stored.severity, 'high'); assert.equal(stored.context, undefined);
  assert.ok(!JSON.stringify(stored).includes('account-a'));
  assert.ok(stored.expiresAt.getTime() - Date.now() > 89 * 86400000);
  quota = false;
  const retry = await send(body); assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, receipt.id); assert.equal(quotaCalls, 1); assert.equal(records.size, 1);
  assert.equal((await send({ ...body, message: 'Changed after submission' })).status, 409);
  assert.equal((await send(payload())).status, 429); assert.equal(records.size, 1);
  quota = true;
  assert.equal((await send(body, 'account-b')).status, 201); assert.equal(records.size, 2, 'Request IDs are scoped to the authenticated account');
  const concurrent = payload({ category: 'general', context: { section: 'Settings', browser: 'Safari' } });
  const responses = await Promise.all([send(concurrent), send(concurrent)]);
  const receipts = await Promise.all(responses.map(response => response.json()));
  assert.equal(receipts[0].id, receipts[1].id); assert.equal(records.size, 3);
  assert.deepEqual(records.get(receipts[0].id).context, { section: 'Settings', browser: 'Safari', appVersion: (process.env.RENDER_GIT_COMMIT || 'development').slice(0, 12) });
  unavailable = true;
  const failed = await send(payload()); assert.equal(failed.status, 503);
  assert.ok((await failed.json()).error.includes('could not be saved')); assert.equal(records.size, 3);
  assert.ok(logs.every(log => !log.includes(body.message) && !log.includes('account-a') && !log.includes('private storage detail')));
  unavailable = false;
  records.set('expired', { expiresAt: new Date(0) });
  await sweepExpiredFeedback(db); assert.equal(records.has('expired'), false); assert.equal(records.size, 3);
} finally {
  console.info = info; console.warn = warn;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log('Feedback HTTP checks passed: authentication, validation, private storage, idempotent retries, quota, failures and expiry.');
