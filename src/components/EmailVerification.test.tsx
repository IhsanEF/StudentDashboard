import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const state: any[] = [];
let index = 0, verified = false, fail = false, sends = 0, signouts = 0;
const users: any[] = [];
const env = {
  useState: (initial: any) => {
    const slot = index++;
    if (!(slot in state)) state[slot] = initial;
    return [state[slot], (value: any) => { state[slot] = value; }];
  },
  checkEmailVerification: async () => verified ? { uid: 'new-user', emailVerified: true } : null,
  sendVerificationEmail: async () => { sends++; if (fail) throw { code: 'auth/too-many-requests' }; }
};
const bundle = await build({ entryPoints: ['src/components/EmailVerification.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['react/jsx-runtime'], plugins: [{ name: 'verification-test', setup(b) {
    b.onResolve({ filter: /^(react|.*\/auth)$/ }, args => ({ path: args.path, namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
      ? 'export const {useState}=globalThis.env;'
      : 'export const {checkEmailVerification,sendVerificationEmail}=globalThis.env;' }));
  } }] });
const module = { exports: {} as any };
new Function('module','exports','require','globalThis',bundle.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url),{env});
function nodes(tree: any): any[] { return tree && typeof tree === 'object' ? [tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)] : []; }
function text(tree: any): string { return typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? React.Children.toArray(tree.props?.children).map(text).join('') : ''; }
const render = () => { index = 0; return module.exports.default({ email: 'student@example.com', verificationSent: false,
  onVerified: (user: any) => users.push(user), onSignOut: async () => { signouts++; } }); };
const button = (label: string) => nodes(render()).find(n => n.type === 'button' && text(n) === label);
assert.match(text(render()), /account was created, but the email could not be sent/);
await button('I’ve verified my email').props.onClick();
assert.equal(users.length, 0);
assert.match(text(render()), /not verified yet/);
await button('Resend verification email').props.onClick();
assert.equal(sends, 1);
assert.match(text(render()), /Verification email sent/);
fail = true;
await button('Resend verification email').props.onClick();
assert.match(text(render()), /wait a few minutes/);
verified = true;
await button('I’ve verified my email').props.onClick();
assert.equal(users[0].emailVerified, true);
await button('Sign out and use another account').props.onClick();
assert.equal(signouts, 1);
console.log('Verification screen: unverified access stays blocked, retry delivery, throttling, verified continuation and sign-out passed.');
