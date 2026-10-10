import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { getDemoTasks } from '../demoData';
import { sanitizeCanvasUrl, sanitizeUrl, canvasLinkReviewWarning, getTaskUrgencyCategory } from '../utils';

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
  const context: any = { tasks: [], now: new Date('2026-10-02T21:00:00Z'), isDemoMode: false, notificationPrefs: {},
    updateTask: async (id: string, payload: any) => writes.push([id, payload]), showToast: (t: any) => messages.push(t.message),
    updateNotificationPrefs: async () => {}, batchAddTasks: async () => {} };
  const env: any = { context, auth: { currentUser: { getIdToken: async () => 'test-token' } } };
  env.hooks = { ...React, useState: (initial: any) => {
    const slot = index++; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
    return [values[slot], (next: any) => values[slot] = typeof next === 'function' ? next(values[slot]) : next];
  }, useEffect: () => {}, useRef: () => ({ current: null }), useMemo: (fn: any) => fn() };
  let response: { ok: boolean; status: number; json: () => Promise<any> } = { ok: false, status: 401, json: async () => ({ error: 'Request rejected' }) };
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'], logLevel: 'silent', plugins: [{ name: 'batch23', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/auth|.*\/(?:TaskBreakdownModal|TaskCard|AddTaskModal))$/ }, args => ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
        ? 'export default globalThis.hooks; export const {useState,useEffect,useRef,useMemo}=globalThis.hooks;'
        : args.path.endsWith('/auth') ? 'export const auth=globalThis.auth;'
        : args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;'
        : args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});'
        : 'export default "child";' }));
    } }] });
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', 'globalThis', 'fetch', 'setTimeout', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), env, async (url: string, opts: any) => { requests.push([url, opts]); return response; }, () => 0);
  return { context, env, writes, messages, requests, response: (next: typeof response) => response = next,
    render: (props: any = {}) => { index = 0; return module.exports.default(props); } };
}
const base = { ...getDemoTasks(new Date('2026-10-02T21:00:00Z'))[0], task_id: 'batch23', demo_seed: false,
  canvas_url: 'https://canvas.ubc.ca.evil.test/login', status: 'Not Started', next_action: '', subtasks: [{ id: 'one', title: 'Step one', done: false }] };
for (const status of ['Not Started', 'Read', 'Done', 'Submitted', 'Working']) {
  const modal = await harness('ProgressModal'); modal.context.tasks = [{ ...base, status }]; let closes = 0;
  const props = { task: modal.context.tasks[0], onClose: () => closes++ };
  let tree = modal.render(props);
  nodes(tree).find(n => n.props?.id === 'next-action-input').props.onChange({ target: { value: 'Next action only' } });
  await nodes(modal.render(props)).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(modal.writes[0][1].status, status); assert.equal(closes, 1); assert.equal(modal.messages.length, 0);
}
for (const action of ['note', 'milestone', 'uncheck']) {
  const modal = await harness('ProgressModal'); modal.context.tasks = [{ ...base, subtasks: [{ ...base.subtasks[0], done: action === 'uncheck' }] }];
  const props = { task: modal.context.tasks[0], onClose: () => {} }; let tree = modal.render(props);
  if (action === 'note') nodes(tree).find(n => n.props?.id === 'progress-note-input').props.onChange({ target: { value: 'started reading' } });
  else nodes(tree).find(n => n.type === 'div' && n.props?.onClick && text(n) === 'Step one').props.onClick();
  await nodes(modal.render(props)).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(modal.writes[0][1].status, action === 'uncheck' ? 'Not Started' : 'Working');
  assert.equal(modal.messages.length, action === 'uncheck' ? 0 : 1);
  if (action === 'note') assert.match(modal.writes[0][1].progress_notes, /^\[.*\] started reading$/);
}
const failed = await harness('ProgressModal'); failed.context.tasks = [base]; let closes = 0;
failed.context.updateTask = async () => { throw new Error('Simulated write failure'); };
const props = { task: base, onClose: () => closes++ };
nodes(failed.render(props)).find(n => n.props?.id === 'progress-note-input').props.onChange({ target: { value: 'Keep this draft' } });
await nodes(failed.render(props)).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.equal(closes, 0); assert.equal(button(failed.render(props), 'Save Progress').props.disabled, false);
assert.equal(nodes(failed.render(props)).find(n => n.props?.id === 'progress-note-input').props.value, 'Keep this draft');
assert.match(failed.messages[0], /Failed to save/);

const review = await harness('ReviewInboxModal'); const open = { isOpen: true, onClose: () => {} };
review.context.notificationPrefs.savedCalendarFeedUrl = 'https://canvas.ubc.ca/feeds/calendars/test.ics';
assert.equal(button(review.render(open), 'Check Canvas now'), undefined);
assert.equal(review.requests.length, 0, 'Legacy feed preferences do not expose or fetch a calendar integration');
review.context.tasks = [{ ...base, needs_review: true }];
let tree = review.render(open); assert.ok(button(tree, 'Confirm')); assert.ok(button(tree, 'Confirm all (1)'));
assert.equal(button(tree, 'Dismiss all'), undefined); assert.ok(button(tree, 'Close'));
assert.ok(nodes(tree).find(n => n.props?.['aria-label'] === 'Close imported items review'));
assert.match(text(nodes(tree).find(n => n.props?.role === 'note')), /canvas.ubc.ca.evil.test/);
const dismiss = nodes(tree).find(n => n.props?.['aria-label'] === `Dismiss ${base.title}`); assert.match(dismiss.props.className, /ml-4/);
review.context.tasks.push({ ...base, task_id: 'second', needs_review: true }); assert.ok(button(review.render(open), 'Confirm all (2)'));
assert.equal(dismiss.props.title, 'Remove this item');
await button(review.render(open), 'Confirm').props.onClick();
assert.equal(review.writes.at(-1)[1].needs_review, false);
const newDueDate = '2026-10-12T23:59:00-07:00';
review.context.tasks = [{ ...base, needs_review: false, canvas_date_diff: { oldDueDate: base.due_at, newDueDate } }];
assert.equal(button(review.render(open), 'Confirm'), undefined);
await button(review.render(open), 'Use imported date').props.onClick();
assert.equal(review.writes.at(-1)[1].due_at, newDueDate);
review.context.tasks.push({ ...base, task_id: 'new-item', needs_review: true });
assert.equal(nodes(review.render(open)).filter(n => n.type === 'button' && text(n).startsWith('Confirm all')).length, 1);
const beforeBulk = review.writes.length;
await button(review.render(open), 'Confirm all (2)').props.onClick();
assert.equal(review.writes.length - beforeBulk, 2);
assert.ok(review.writes.slice(beforeBulk).some(([, payload]) => payload.needs_review === false));
assert.ok(review.writes.slice(beforeBulk).some(([, payload]) => payload.due_at === newDueDate));


const list = await harness('TasksList');
list.context.tasks = [{ ...base, type: 'lecture', due_at: '2026-10-01T10:00:00-07:00' },
  { ...base, task_id: 'lab', type: 'lab', points_possible: '0', due_at: '2026-10-01T10:00:00-07:00' }];
for (const task of list.context.tasks) assert.equal(getTaskUrgencyCategory(task, list.context.now), 'past_schedule');
tree = list.render(); const past = nodes(tree).find(n => n.props?.id === 'task-group-past-classes');
assert.equal(past.type, 'details'); assert.ok(!past.props.open); assert.match(text(past), /Past classes \(2\)/);
assert.equal(nodes(tree).some(n => n.props?.id === 'task-group-no-date'), false);
for (const url of ['mailto:prof@ubc.ca', 'javascript:alert(1)', 'data:text/html,hello']) assert.equal(sanitizeCanvasUrl(url), '');
assert.equal(sanitizeUrl('mailto:prof@ubc.ca'), 'mailto:prof@ubc.ca');
for (const url of ['https://canvas.ubc.ca.evil.test/login', 'https://evilubc.ca/login', 'https://canvas.ubc.ca@evil.test/login']) assert.match(canvasLinkReviewWarning(url), /External task link/);
for (const url of ['https://canvas.ubc.ca/course/1', 'https://learn.ubc.ca/course/1', 'https://ubc.instructure.com/course/1']) assert.match(canvasLinkReviewWarning(url), /External task link/);
console.log('Batch 23 progress status/draft recovery, authenticated sync/error roles, single-item review, past classes and link security checks passed.');
