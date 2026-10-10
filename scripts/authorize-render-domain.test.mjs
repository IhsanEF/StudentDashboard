import assert from 'node:assert/strict';
import { authorizeRenderDomain } from './authorize-render-domain.mjs';

const projectId = 'gen-lang-client-0442042800', hostname = 'studentdashboardlms.onrender.com';
const requests = [];
const credential = { getAccessToken: async () => ({ access_token: 'test-only-token' }) };
const domains = ['original.firebaseapp.com', 'existing.example.com'];
let status = 200, current = domains;
const request = async (url, options) => {
  requests.push({ url, options });
  return { ok: status === 200, status, json: async () => ({
    authorizedDomains: options.method === 'PATCH' ? JSON.parse(options.body).authorizedDomains : current
  }) };
};
const options = { projectId, hostname, credential, request };
const deniedCredential = { getAccessToken: () => { throw new Error('Skipped hosts must not access credentials'); } };
assert.equal(await authorizeRenderDomain({ ...options, credential: deniedCredential, hostname: 'attacker.example.com' }), 'skipped');
assert.equal(await authorizeRenderDomain({ ...options, credential: deniedCredential, projectId: 'other-project' }), 'skipped');
assert.equal(requests.length, 0);
assert.equal(await authorizeRenderDomain(options), 'authorized');
assert.equal(requests.length, 2);
assert.deepEqual(JSON.parse(requests[1].options.body), { authorizedDomains: [...domains, hostname] });
assert.ok(requests[1].url.endsWith('?updateMask=authorizedDomains'));
assert.equal(requests[1].options.headers.Authorization, 'Bearer test-only-token');
requests.length = 0; current = [...domains, hostname];
assert.equal(await authorizeRenderDomain(options), 'already-authorized');
assert.equal(requests.length, 1, 'An authorized deployment must never rewrite config');
requests.length = 0;
const newHost = 'mylmsapp.onrender.com';
assert.equal(await authorizeRenderDomain({ ...options, hostname: newHost }), 'authorized');
assert.deepEqual(JSON.parse(requests[1].options.body), { authorizedDomains: [...domains, hostname, newHost] },
  'The new address preserves the existing address and every other authorized domain');
requests.length = 0; current = [...current, newHost];
assert.equal(await authorizeRenderDomain({ ...options, hostname: newHost }), 'already-authorized');
assert.equal(requests.length, 1, 'The new address is also idempotent');
requests.length = 0; status = 403;
await assert.rejects(() => authorizeRenderDomain(options), /read rejected \(403\)/);
assert.equal(requests.length, 1, 'Permission failures never attempt a write');
status = 200; current = undefined;
await assert.rejects(() => authorizeRenderDomain(options), /Invalid authorized domain/);
console.log('Auth domain migration: exact project/host guards, preserves domains, field mask, idempotence and denied access passed.');
