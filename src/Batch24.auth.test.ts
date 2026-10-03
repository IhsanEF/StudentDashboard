import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function harness(fallback = false) {
  const calls: string[] = [];
  const env: any = { auth: {}, log: null, settings: null, rejectPersistence: false,
    initializeApp: () => ({}), onLog: (fn: any) => env.log = fn,
    getAuth: () => env.auth, GoogleAuthProvider: class {},
    browserSessionPersistence: 'session', browserLocalPersistence: 'local',
    setPersistence: async (_: any, persistence: string) => {
      calls.push(persistence); if (env.rejectPersistence) throw new Error('Storage unavailable');
    },
    signInWithPopup: async () => { calls.push('popup'); return { user: { uid: 'test' } }; },
    signInWithRedirect: async () => { calls.push('redirect'); },
    persistentMultipleTabManager: () => 'multiple-tabs', persistentLocalCache: (options: any) => options,
    initializeFirestore: (_: any, settings: any) => { env.settings = settings; return {}; },
    doc: (_: any, ...path: string[]) => path,
    getDocFromCache: async () => {
      calls.push('cache-only-read');
      if (fallback) env.log({ type: '@firebase/firestore', message: 'Firestore: Error using user provided cache. Falling back to memory cache: IndexedDB unavailable' });
      throw { code: 'unavailable' }; // Probe document is absent, provider initialization is complete.
    }
  };
  const bundle = await build({ entryPoints: ['src/auth.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'auth-boundary', setup(b) {
      b.onResolve({ filter: /^firebase\// }, args => ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const {
        initializeApp,onLog,getAuth,setPersistence,browserSessionPersistence,browserLocalPersistence,
        GoogleAuthProvider,signInWithPopup,signInWithRedirect,persistentMultipleTabManager,
        persistentLocalCache,initializeFirestore,doc,getDocFromCache
      }=globalThis.env;
      export const getRedirectResult=async()=>null,onAuthStateChanged=()=>()=>{},signOut=async()=>{},
        getFirestore=()=>({}),terminate=async()=>{},clearIndexedDbPersistence=async()=>{};` }));
    } }] });
  const module = { exports: {} as any };
  new Function('module','exports','require','globalThis', bundle.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url),{env});
  return { api: module.exports, env, calls };
}
const session = await harness();
assert.equal(session.env.settings.localCache.tabManager, 'multiple-tabs');
await session.api.googleSignIn(); assert.deepEqual(session.calls, ['session', 'popup']);
session.calls.length = 0;
await session.api.googleSignIn(true); assert.deepEqual(session.calls, ['session', 'redirect']);
session.calls.length = 0;
await session.api.googleSignIn(false, true); assert.deepEqual(session.calls, ['local', 'popup']);
session.calls.length = 0;
await session.api.googleSignIn(true, true); assert.deepEqual(session.calls, ['local', 'redirect']);
session.calls.length = 0; session.env.rejectPersistence = true;
await assert.rejects(() => session.api.googleSignIn(), /Storage unavailable/);
assert.deepEqual(session.calls, ['session'], 'A failed persistence choice must prevent sign-in');
for (const fallback of [false, true]) {
  const cache = await harness(fallback); const statuses: string[] = [];
  const unsubscribe = cache.api.subscribeOfflineCacheStatus((status: string) => statuses.push(status));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.api.getOfflineCacheStatus(), fallback ? 'memory' : 'persistent');
  assert.equal(statuses.at(-1), fallback ? 'memory' : 'persistent');
  assert.deepEqual(cache.calls, ['cache-only-read']);
  unsubscribe();
  const count = statuses.length;
  cache.env.log({ type: '@firebase/firestore', message: 'Falling back to memory cache: failure' });
  assert.equal(statuses.length, count, 'Unsubscribed components must not receive state writes');
}
console.log('Batch 24 auth: session default, opt-in local persistence for both flows, persistence failure prevents sign-in, multi-tab cache and asynchronous memory fallback passed.');
