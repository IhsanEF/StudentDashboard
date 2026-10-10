import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const state: any[] = [];
let index = 0;
const calls: any[] = [], users: any[] = [];
let failure: any = null;
let finishSignIn: ((user: any) => void) | null = null;
const env = {
  hooks: { useState: (initial: any) => {
    const slot = index++;
    if (!(slot in state)) state[slot] = initial;
    return [state[slot], (value: any) => { state[slot] = value; }];
  }, useEffect: () => {} },
  googleSignIn: async (...args: any[]) => { calls.push(['google', ...args]); throw { code: 'auth/popup-blocked' }; },
  emailSignIn: async (...args: any[]) => {
    calls.push(['email', ...args]);
    if (failure) throw failure;
    return new Promise(resolve => { finishSignIn = resolve; });
  },
  emailSignUp: async (...args: any[]) => { calls.push(['signup', ...args]); if (failure) throw failure; return { user: { uid: 'new-user', emailVerified: false }, verificationSent: true }; },
  resetPassword: async (...args: any[]) => { calls.push(['reset', ...args]); if (failure) throw failure; }
};
const bundle = await build({ entryPoints: ['src/components/Login.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['react/jsx-runtime', 'lucide-react'], plugins: [{ name: 'login-test', setup(b) {
    b.onResolve({ filter: /^(react|.*\/auth|.*\/PrivacyModal)$/ }, args => ({ path: args.path, namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
      ? 'export const {useState,useEffect}=globalThis.env.hooks;'
      : args.path.endsWith('/auth') ? 'export const {googleSignIn,emailSignIn,emailSignUp,resetPassword}=globalThis.env;'
      : 'export default () => null;' }));
  } }] });
const module = { exports: {} as any };
new Function('module', 'exports', 'require', 'globalThis', 'console', bundle.outputFiles[0].text)(
  module, module.exports, createRequire(import.meta.url), { env }, { error() {} });
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
function text(tree: any): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return React.Children.toArray(tree.props?.children).map(text).join('');
}
const render = () => { index = 0; return module.exports.default({ onLogin: (user: any) => users.push(user), onDemoLogin() {} }); };
const button = (label: string) => nodes(render()).find(n => n.type === 'button' && text(n) === label);
const input = (id: string) => nodes(render()).find(n => n.props?.id === id);
assert.ok(button('Sign in with Google'));
assert.ok(button('Sign in with email'));
await button('Sign in with Google').props.onClick();
assert.match(text(render()), /Allow pop-ups/);
assert.equal(button('Pop-up blocked? Sign in on this page instead'), undefined);
button('Sign in with email').props.onClick();
assert.equal(input('login-email').props.autoComplete, 'username');
assert.equal(input('login-password').props.type, 'password');
await button('Forgot password?').props.onClick();
assert.match(text(render()), /Enter your email address/);
assert.equal(calls.some(call => call[0] === 'reset'), false);
input('login-email').props.onChange({ target: { value: 'student@example.com' } });
input('login-password').props.onChange({ target: { value: 'a test password' } });
nodes(render()).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
const pending = nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.ok(button('Sign in with Google').props.disabled);
assert.ok(button('Signing in...').props.disabled);
assert.deepEqual(calls.at(-1), ['email', 'student@example.com', 'a test password', true]);
finishSignIn!({ uid: 'existing-user' });
await pending;
assert.deepEqual(users, [{ uid: 'existing-user' }]);
assert.equal(input('login-password').props.value, '');
failure = { code: 'auth/invalid-credential' };
await nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.match(text(render()), /email or password is incorrect/);
assert.equal(users.length, 1);
failure = null;
await button('Forgot password?').props.onClick();
assert.deepEqual(calls.at(-1), ['reset', 'student@example.com']);
assert.match(text(render()), /If an account exists/);
failure = { code: 'auth/user-not-found' };
await button('Forgot password?').props.onClick();
assert.match(text(render()), /If an account exists/);
console.log('Login: email form, persistence choice, busy state, credential errors and private reset feedback passed.');

failure = null;
button('Create an account with email').props.onClick();
assert.equal(input('login-password').props.autoComplete, 'new-password');
assert.equal(input('confirm-password').props.required, true);
input('login-password').props.onChange({ target: { value: 'NewPassword123!' } });
input('confirm-password').props.onChange({ target: { value: 'different' } });
await nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.match(text(render()), /passwords do not match/);
assert.equal(calls.some(call => call[0] === 'signup'), false);
input('confirm-password').props.onChange({ target: { value: 'NewPassword123!' } });
await nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.deepEqual(calls.at(-1), ['signup', 'student@example.com', 'NewPassword123!', true]);
assert.equal((users as any[]).at(-1)?.emailVerified, false);
assert.equal(input('confirm-password').props.value, '');
failure = { code: 'auth/email-already-in-use' };
await nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.match(text(render()), /account already uses this email/);
button('Sign in with email').props.onClick();
assert.equal(input('login-password').props.autoComplete, 'current-password');
assert.equal(input('confirm-password'), undefined);
console.log('Email registration: confirmation validation, account creation, duplicate recovery and mode switching passed.');
