import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...(Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children)).flatMap(nodes)];
}
function text(tree: any): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return (Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children)).map(text).join('');
}
const button = (tree: any, label: string) => nodes(tree).find(n => n.type === 'button' && text(n).trim() === label);
async function harness(name: string) {
  const values: any[] = [], writes: any[] = [], messages: string[] = [], requests: any[] = [];
  let index = 0;
  const context: any = { tasks: [], now: new Date('2026-10-02T21:00:00Z'), isDemoMode: false, notificationPrefs: {}, courses: [],
    updateTask: async (id: string, payload: any) => writes.push([id, payload]), showToast: (t: any) => messages.push(t.message),
    updateNotificationPrefs: async () => {}, batchAddTasks: async () => {} };
  const env: any = { context, auth: { currentUser: { getIdToken: async () => 'test-token' } } };
  env.cacheStatus = 'checking';
  env.hooks = { ...React, useState: (initial: any) => {
    const slot = index++; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
    return [values[slot], (next: any) => values[slot] = typeof next === 'function' ? next(values[slot]) : next];
  }, useEffect: () => {}, useRef: (initial: any) => { const slot = index++; return values[slot] ||= {current: initial}; }, useMemo: (fn: any) => fn() };
  let response: { ok: boolean; status: number; json: () => Promise<any> } = { ok: false, status: 401, json: async () => ({ error: 'Request rejected' }) };
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'], logLevel: 'silent', plugins: [{ name: 'batch23', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/auth|.*\/services\/db|.*\/(?:ImportWorkloadWarning|PrivacyModal))$/ }, args => ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
        ? 'export default globalThis.hooks; export const {useState,useEffect,useRef,useMemo}=globalThis.hooks;'
        : args.path.endsWith('/auth') ? 'export const auth=globalThis.auth; export const getOfflineCacheStatus=()=>globalThis.cacheStatus; export const subscribeOfflineCacheStatus=()=>()=>{};'
        : args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;'
        : args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});'
        : args.path.endsWith('/db') ? 'export const saveFirestoreCourse=async()=>{},batchImportTasksAndCourses=async()=>{};'
        : 'export default "child";' }));
    } }] });
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', 'globalThis', 'fetch', 'setTimeout', 'clearTimeout', 'Date', 'crypto', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), env, async (url: string, opts: any) => { requests.push([url, opts]); return response; }, () => 0, () => {}, class extends Date { static now() { return 12345; } }, globalThis.crypto);
  return { context, env, writes, messages, requests, response: (next: typeof response) => response = next,
    render: (props: any = {}) => { index = 0; return (module.exports.SyllabusImportBody || module.exports.OfflineIndicator || module.exports.default)(props); } };
}

const syllabus = await harness('SyllabusImportModal');
const props = { isOpen: true, preselectedCourseCode: 'CPSC 310' };
const upload = (name: string) => {
  nodes(syllabus.render(props)).find(n => n.type === 'input' && n.props.type === 'file').props.onChange({
    target: { files: [{ name, type: 'text/plain', size: 10, text: async () => 'unrelated content' }] }
  });
};
upload('empty.txt');
syllabus.response({ ok: true, status: 200, json: async () => ({ courses: [], tasks: [] }) });
await button(syllabus.render(props), 'Read this').props.onClick();
assert.match(text(syllabus.render(props)), /No course information could be extracted.*clearer scan/);
assert.equal(button(syllabus.render(props), 'Confirm & Import to Dashboard'), undefined);
syllabus.response({ ok: false, status: 503, json: async () => ({ error: 'Set GEMINI_API_KEY' }) });
await button(syllabus.render(props), 'Read this').props.onClick();
assert.match(text(syllabus.render(props)), /currently unavailable.*try again later/);
assert.doesNotMatch(text(syllabus.render(props)), /GEMINI_API_KEY/);
syllabus.response({ ok: true, status: 200, json: async () => ({ courses: [{ course_code: 'CPSC 310', course_name: 'Software', grade_categories: [] }], tasks: [] }) });
await button(syllabus.render(props), 'Read this').props.onClick();
for (let i = 0; i < 5; i++) button(syllabus.render(props), 'Add Item').props.onClick();
const ids = nodes(syllabus.render(props)).filter(n => n.type === 'input' && n.props.id?.startsWith('task-check-task-manual')).map(n => n.props.id);
assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5, 'Manual rows remain unique at the same timestamp');

const offline = await harness('OfflineIndicator');
offline.context.isOnline = false;
for (const [status, copy] of [['checking', /Checking device storage/], ['memory', /only kept in this tab/], ['persistent', /saved on this device/]] as const) {
  const view = await harness('OfflineIndicator'); view.context.isOnline = false; view.env.cacheStatus = status;
  const tree = view.render();
  assert.match(text(tree), copy); assert.equal(tree.props.role, 'status'); assert.equal(tree.props['aria-live'], 'polite');
  if (status === 'persistent') assert.match(text(tree), /You're offline — showing your last saved data/);
  assert.doesNotMatch(tree.props.className, /fixed|bottom-/);
}
offline.context.isDemoMode = true;
assert.match(text(offline.render()), /stored in memory and not saved/);
offline.context.isOnline = true; assert.equal(offline.render(), null);
assert.equal((readFileSync('src/components/DashboardLayout.tsx', 'utf8').match(/<OfflineIndicator/g) || []).length, 1);

const server = readFileSync('server.ts', 'utf8');
const matching = server.slice(server.indexOf('export function matchGradeCategory('), server.indexOf('function parseExcelInWorker('));
const js = await transform(matching, { loader: 'ts', format: 'cjs' });
const module = { exports: {} as any }; new Function('module', 'exports', js.code)(module, module.exports);
const categories = [{ id: 'midterm', name: 'Midterm' }, { id: 'project', name: 'Projects' }, { id: 'quiz', name: 'Quizzes' }];
assert.equal(module.exports.matchGradeCategory(categories, '', 'Project Mgmt Report', 'project').categoryId, 'project');
assert.equal(module.exports.matchGradeCategory(categories, '', 'Mgmt Quiz', 'quiz').categoryId, 'quiz');
console.log('Batch 24: empty/503 syllabus results, same-timestamp manual IDs, one offline live region with truthful storage copy, and server Mgmt boundaries passed.');
