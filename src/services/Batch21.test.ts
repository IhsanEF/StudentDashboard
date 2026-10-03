import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initializeApp, deleteApp } from 'firebase/app';
import * as transport from 'firebase/firestore';
import { initializeFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, terminate } from 'firebase/firestore';
import { Task } from '../types';
import { getTaskEstimatedHours, getTaskSubtaskDurationSum, computeWeeklyWorkload } from './workloadService';

const task = (overrides: Partial<Task> = {}): Task => ({
  task_id: 'quiz', type: 'quiz', course: 'TEST 100', title: 'Quiz', due_at: '2026-10-02', status: 'Not Started',
  check_again_at: '', canvas_url: '', summary: '', source_message_id: '', last_email_at: '', needs_review: false,
  points_earned: '', points_possible: '', grade_text: '', feedback: '', progress_notes: '', next_action: '', last_interaction_at: '', ...overrides
});
const step = (duration?: string) => ({ id: 'step', title: 'Plan', done: false, ...(duration === undefined ? {} : { duration }) });
const now = new Date('2026-10-02T19:00:00Z');
const baseline = task();
const partial = task({ subtasks: [step('30m')] });
assert.equal(getTaskEstimatedHours(partial), 1.5);
assert.equal(computeWeeklyWorkload([partial], 15, 6, now).thisWeekHours, computeWeeklyWorkload([baseline], 15, 6, now).thisWeekHours);
assert.equal(getTaskEstimatedHours(task({ estimated_hours: 1.1, subtasks: [step('8h')] })), 1.1);
assert.equal(getTaskEstimatedHours(task({ type: 'assignment', title: 'Finalize Assignment 2' })), 4);
assert.equal(getTaskEstimatedHours(task({ title: 'Syllabus Quiz' })), 1.5);
assert.equal(getTaskEstimatedHours(task({ type: 'reading', title: 'Final exam study guide' })), 1);
assert.equal(getTaskEstimatedHours(task({ type: 'unknown', title: 'Finalize syllabus' })), 2);
assert.equal(getTaskEstimatedHours(task({ type: '', title: 'Final exam' })), 8);
assert.equal(getTaskEstimatedHours(task({ type: 'unknown', title: 'Syllabus Quiz' })), 1.5);
for (const [duration, hours] of [['2h 30m', 2.5], ['1 hour 30 minutes', 1.5], ['2h30m', 2.5], ['45 mins', 0.8], ['1.5 hours', 1.5], ['.5 hours', 0.5], ['2 days', 0], ['', 0], ['month', 0]] as const) {
  assert.equal(getTaskSubtaskDurationSum(task({ subtasks: [step(duration)] })), hours, duration);
}
assert.equal(getTaskSubtaskDurationSum(task({ subtasks: [step(), step('2 days'), step('2h 30m')] })), 2.5);
const decimals = [task({ estimated_hours: 1.1 }), task({ task_id: 'two', estimated_hours: 2.2 })];
assert.equal(computeWeeklyWorkload(decimals, 15, 6, now).weeks[0].days[4].totalHours, 3.3);

// Exercise the actual Workload screen and day selection with controlled task context.
const context = { tasks: decimals, now, notificationPrefs: {}, updateNotificationPrefs: async () => {}, updateTask: async () => {} };
const values: any[] = [];
let index = 0;
const hooks = { ...React, useMemo: (fn: any) => fn(), useEffect: () => {}, useRef: (value: any) => ({ current: value }),
  useState: (initial: any) => { const slot = index++; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
    return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; } };
const screenBundle = await build({ entryPoints: ['src/components/WorkloadTab.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['react/jsx-runtime', 'lucide-react'], logLevel: 'silent', plugins: [{ name: 'workload-context', setup(builder) {
    builder.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/(EditTaskModal|TaskCard))$/ }, args => ({ path: args.path, namespace: 'screen' }));
    builder.onLoad({ filter: /.*/, namespace: 'screen' }, args => ({ contents: args.path === 'react'
      ? 'export default globalThis.hooks; export const {useMemo,useEffect,useState,useRef}=globalThis.hooks;'
      : args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;' : 'export default ()=>null;' }));
  } }] });
const screenModule = { exports: {} as any };
new Function('module', 'exports', 'require', 'globalThis', screenBundle.outputFiles[0].text)(screenModule, screenModule.exports, createRequire(import.meta.url), { hooks, context });
const render = () => { index = 0; return screenModule.exports.default({}); };
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...(Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children)).flatMap(nodes)];
}
let tree = render();
let friday = nodes(tree).find(n => n.props?.['aria-label'] === 'Friday 2026-10-02: 3.3 hours, 2 tasks');
assert.ok(friday);
assert.match(renderToStaticMarkup(friday), />3\.3h</);
assert.doesNotMatch(renderToStaticMarkup(tree), /3\.3000000000000003/);
friday.props.onClick(); tree = render();
friday = nodes(tree).find(n => n.props?.['aria-label'] === 'Friday 2026-10-02: 3.3 hours, 2 tasks');
assert.equal(friday.props['aria-pressed'], true);
assert.match(renderToStaticMarkup(tree), /Tasks Due on Selected Day \(Fri 2\)/);
context.tasks = [partial];
assert.match(renderToStaticMarkup(render()), /Friday 2026-10-02: 1\.5 hours, 1 task"/);
context.tasks = [task({ type: 'assignment', title: 'Finalize Assignment 2' }), task({ task_id: 'syllabus', title: 'Syllabus Quiz' })];
assert.match(renderToStaticMarkup(render()), /Friday 2026-10-02: 5\.5 hours, 2 tasks/);
console.log('Batch 21 workload screen: Friday shows 3.3h, day selection works, partial quiz stays 1.5h, assignment + quiz total 5.5h.');

// Load the real database service against emulator clients, with no production connection.
async function service(db: any) {
  const bundle = await build({ entryPoints: ['src/services/db.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'emulator-transport', setup(builder) {
      builder.onResolve({ filter: /^(\.\.\/auth|firebase\/(firestore|auth))$/ }, args => ({ path: args.path, namespace: 'emulator' }));
      builder.onLoad({ filter: /.*/, namespace: 'emulator' }, args => ({ contents: args.path === '../auth' ? 'export const db=globalThis.testDb;'
        : args.path.endsWith('/auth') ? '' : ['collection','doc','getDoc','getDocs','setDoc','updateDoc','deleteDoc','deleteField','onSnapshot','serverTimestamp','writeBatch','runTransaction','query','where','limit']
          .map(name => `export const ${name}=(...args)=>globalThis.transport.${name}(...args);`).join('\n') }));
    } }] });
  const module = { exports: {} as any };
  new Function('module','exports','require','globalThis',bundle.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url),{ testDb: db, transport });
  return module.exports;
}

if (process.env.FIRESTORE_EMULATOR_HOST) {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  assert.ok(['127.0.0.1', 'localhost'].includes(host));
  const databaseId = 'ai-studio-ubcstudentdashbo-5e81b2ee-a65d-4637-a20b-681e4b750ef3';
  const clients = ['creator', 'next', 'third', 'outsider'].map(uid => {
    const app = initializeApp({ projectId: 'demo-batch21', apiKey: 'fake', appId: 'fake' }, `batch21-${uid}`);
    const db = initializeFirestore(app, {}, databaseId);
    connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, user_id: uid, email: `${uid}@example.com` } });
    return { uid, app, db };
  });
  try {
    const [creator, next, third, outsider] = clients;
    const creatorApi = await service(creator.db);
    const nextApi = await service(next.db);
    const thirdApi = await service(third.db);
    // Reproduce the original defect even for legacy documents that still name
    // a departed creator. This proves membership is required independently of transfer.
    const legacyId = `legacy-left-${Date.now()}`;
    const seeded = await fetch(`http://${host}:${port}/v1/projects/demo-batch21/databases/${databaseId}/documents/groups/${legacyId}`, {
      method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        created_by: { stringValue: 'creator' }, members: { arrayValue: { values: [{ stringValue: 'next' }] } },
        invite_code: { stringValue: 'UBC999' }
      } })
    });
    assert.equal(seeded.status, 200);
    await assert.rejects(deleteDoc(doc(creator.db, 'groups', legacyId)), /permission/i);
    await assert.rejects(deleteDoc(doc(next.db, 'groups', legacyId)), /permission/i);
    const group = await creatorApi.createFirestoreGroupProject('creator', { displayName: 'Creator' }, { name: 'Ownership test', course_code: 'TEST 100' });
    await nextApi.joinFirestoreGroupByCode('next', { displayName: 'Next' }, group.invite_code);
    const ref = (client: typeof creator) => doc(client.db, 'groups', group.id);
    const stored = (await getDoc(ref(next))).data()!;
    const maliciousJoin = { members: [...stored.members, 'third'], member_details: { ...stored.member_details, third: { uid: 'third', displayName: 'Third', role: 'member' } } };
    await assert.rejects(updateDoc(ref(third), { ...maliciousJoin, member_details: { ...maliciousJoin.member_details, creator: { ...stored.member_details.creator, displayName: 'Tampered' } } }), /permission/i);
    await assert.rejects(updateDoc(ref(third), { ...maliciousJoin, member_details: { third: maliciousJoin.member_details.third } }), /permission/i);
    await assert.rejects(updateDoc(ref(third), { ...maliciousJoin, member_details: { ...maliciousJoin.member_details, third: { uid: 'third', displayName: 'Third', role: 'owner' } } }), /permission/i);
    await assert.rejects(updateDoc(ref(third), { members: maliciousJoin.members }), /permission/i);
    await thirdApi.joinFirestoreGroupByCode('third', { displayName: 'Third' }, group.invite_code);
    await assert.rejects(deleteDoc(ref(outsider)), /permission/i);
    await assert.rejects(deleteDoc(ref(next)), /permission/i);
    await assert.rejects(updateDoc(ref(next), { created_by: 'next' }), /permission/i);
    await assert.rejects(updateDoc(ref(creator), { created_by: 'next' }), /permission/i);
    await assert.rejects(updateDoc(ref(creator), { created_by: 'third', members: ['next', 'third'] }), /permission/i);
    await creatorApi.leaveFirestoreGroup('creator', group.id);
    const transferred = (await getDoc(ref(next))).data()!;
    assert.equal(transferred.created_by, 'next');
    assert.deepEqual(transferred.members, ['next', 'third']);
    assert.equal('creator' in transferred.member_details, false);
    assert.equal(transferred.member_details.next.role, 'owner');
    assert.deepEqual(transferred.member_details.third, { uid: 'third', displayName: 'Third', role: 'member' });
    await assert.rejects(deleteDoc(ref(creator)), /permission/i);
    await assert.rejects(updateDoc(ref(creator), { created_by: 'creator' }), /permission/i);
    await assert.rejects(setDoc(doc(creator.db, 'groups', group.id, 'tasks', 'left-member'), { title: 'Denied', group_id: group.id, created_by: 'creator' }), /permission/i);
    await nextApi.leaveFirestoreGroup('next', group.id);
    assert.equal((await getDoc(ref(third))).data()!.created_by, 'third');
    await thirdApi.leaveFirestoreGroup('third', group.id);
    // Reads of absent group documents are denied by the existing read rule.
    // The emulator-only admin endpoint verifies that the last leave deleted it.
    const deleted = await fetch(`http://${host}:${port}/v1/projects/demo-batch21/databases/${databaseId}/documents/groups/${group.id}`, {
      headers: { Authorization: 'Bearer owner' }
    });
    assert.equal(deleted.status, 404);
    const deletable = await creatorApi.createFirestoreGroupProject('creator', {}, { name: 'Delete allowed', course_code: 'TEST' });
    await deleteDoc(doc(creator.db, 'groups', deletable.id));
    console.log('Batch 21 named-database emulator: creator leave transfers ownership; former creators, non-owner members and outsiders cannot delete; self-joins preserve teammate details; current owner can delete.');
  } finally {
    await Promise.all(clients.map(async c => { await terminate(c.db); await deleteApp(c.app); }));
  }
}
