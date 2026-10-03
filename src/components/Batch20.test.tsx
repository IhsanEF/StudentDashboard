import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { DEMO_TASKS, getDemoTasks, getDemoExams, getDemoTerm, DEMO_CLASSES, getDemoMeetingTimes } from '../demoData';
import { getTaskUrgencyCategory, parseTaskDueDate, toVancouverDateString } from '../utils';
import { computeWeeklyWorkload } from '../services/workloadService';
import { Task } from '../types';
import { readFileSync } from 'node:fs';
async function harness(name: string) {
  const values: any[] = [], deps: any[][] = [], writes: any[] = [];
  let index = 0, effects: (() => void)[] = [];
  const context: any = { tasks: [], now: new Date('2026-09-02T21:00:00Z'), notificationPrefs: {}, courses: [], isDemoMode: true, showToast: () => {}, addTask: async () => {},
    updateNotificationPrefs: async (prefs: any) => { writes.push(prefs); context.notificationPrefs = prefs; }, updateTask: async () => {} };
  const hooks = { ...React, useState: (initial: any) => {
    const slot = index++;
    if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
    return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
  }, useRef: (initial: any) => { const slot = index++; return values[slot] ||= { current: initial }; },
  useCallback: (fn: any) => fn, useId: () => 'test-id', useMemo: (fn: any) => fn(), useEffect: (fn: any, next: any[]) => {
    const slot = index++;
    if (!deps[slot] || next.some((v, i) => v !== deps[slot][i])) { deps[slot] = next; effects.push(fn); }
  } };
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'], logLevel: 'silent', plugins: [{ name: 'batch19', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/hooks\/useViewMode|.*\/hooks\/useFocusTimer|.*\/auth|.*\/CourseWeightingModal|.*\/EditTaskModal|.*\/TaskCard)$/ }, args => ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
        ? 'export default globalThis.hooks; export const {useState,useRef,useMemo,useEffect,useId,useCallback}=globalThis.hooks;'
        : args.path.endsWith('/auth') ? 'export const auth={currentUser:null,onAuthStateChanged:()=>()=>{}}; export const getAuthHeader=async()=>({});'
        : args.path.endsWith('/useFocusTimer') ? 'export const useFocusTimerContext=()=>globalThis.context;'
        : args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;'
        : args.path.endsWith('/useViewMode') ? 'export const useViewMode=()=>({isDetailed:true,isSimple:false});'
        : args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});'
        : 'export default ()=>null;' }));
    } }] });
  const module = { exports: {} as any };
  const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const document = { querySelectorAll: () => [], querySelector: () => null, body: {} };
  new Function('module', 'exports', 'require', 'globalThis', 'window', 'document', 'MutationObserver', 'localStorage', 'sessionStorage', 'fetch', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), { hooks, context }, { innerWidth: 1400 }, document,
    class { observe() {} disconnect() {} }, store, store, async () => ({ ok: true, json: async () => ({ source: 'fallback', subtasks: [{ id: 'bad', title: 'Unscaled server fallback', duration: '100 hours' }] }) }));
  return { context, writes, api: module.exports, render: (props: any = {}) => {
    index = 0; const tree = module.exports.default(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree;
  } };
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...(Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children)).flatMap(nodes)];
}
function text(tree: any): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return (Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children)).map(text).join('');
}
const find = (tree: any, label: string) => nodes(tree).find(n => n.props?.['aria-label'] === label);


const frozen = new Date('2026-09-04T18:44:00-07:00');
const samples = getDemoTasks(frozen);
const task = (due: string): Task => ({ ...samples[1], due_at: due });
assert.equal(getTaskUrgencyCategory(task('2026-09-11'), frozen), 'upcoming');
assert.equal(getTaskUrgencyCategory(task('2026-09-11T23:59:00-07:00'), frozen), 'upcoming');
assert.equal(getTaskUrgencyCategory(task('2026-09-12'), frozen), 'later');
// Calendar boundaries are unchanged by DST or the host's timezone.
assert.equal(getTaskUrgencyCategory(task('2026-03-14'), new Date('2026-03-07T00:30:00-08:00')), 'upcoming');
assert.equal(getTaskUrgencyCategory(task('2026-11-07'), new Date('2026-10-31T00:30:00-07:00')), 'upcoming');
assert.equal(getTaskUrgencyCategory(samples[1], frozen), 'today');
assert.equal(getDemoTasks(new Date('2026-09-05T08:00:00Z'))[1].due_at, '2026-09-05');
assert.equal(getDemoTasks(new Date('2026-09-05T06:59:00Z'))[1].due_at, '2026-09-04');
for (const st of samples.flatMap(t => t.subtasks || [])) {
  assert.match(st.startDate!, /^\d{4}-\d{2}-\d{2}$/); assert.match(st.doByDate!, /^\d{4}-\d{2}-\d{2}$/);
}
const term = getDemoTerm(frozen), exams = getDemoExams(frozen);
for (const t of samples.filter(t => t.status === 'Done')) assert.ok(t.due_at >= term.start_date);
for (const e of exams) assert.ok(e.date >= term.start_date && e.date <= term.end_date);
const final = samples.find(t => t.task_id === 'demo-cpsc-final')!;
const exam = exams.find(e => e.course_code === 'CPSC 310')!;
assert.equal(toVancouverDateString(parseTaskDueDate(final.due_at)), exam.date);
for (let i = 0; i < exams.length; i++) for (let j = i + 1; j < exams.length; j++) {
  assert.ok(exams[i].date !== exams[j].date || exams[i].end_time <= exams[j].start_time || exams[j].end_time <= exams[i].start_time);
}
assert.equal(getDemoMeetingTimes('ENGL 112'), 'Tue / Thu 12:00 PM - 1:30 PM');
assert.ok(DEMO_CLASSES.filter(c => c.course_code === 'ENGL 112').every(c => c.start_time === '12:00' && c.end_time === '13:30'));
const workload = computeWeeklyWorkload(samples, undefined, undefined, frozen);
assert.ok(workload.weeks.filter(w => w.taskCount > 0).length >= 3);
assert.ok(workload.weeks.some(w => w.isCrunchWeek));

const planner = await harness('TaskBreakdownModal');
const legacyTask = { ...samples[2], subtasks: [{ id: 'legacy', title: 'Legacy step', done: false,
  startDate: '2026-09-04T01:00:00Z', doByDate: '2026-09-06T23:00:00-07:00', duration: '1 hour' }] };
const props = { task: legacyTask, isOpen: true, onClose: () => {} };
planner.render(props);
let tree = planner.render(props);
assert.equal(find(tree, 'Step 1 start date').props.value, '2026-09-03');
assert.equal(find(tree, 'Step 1 do by date').props.value, '2026-09-06');
assert.doesNotMatch(text(tree), /Do-by date is after/);
const quizProps = { ...props, task: { ...samples[1], subtasks: [], due_at: `${toVancouverDateString(new Date())}T23:59:00-07:00` } };
planner.render(quizProps); tree = planner.render(quizProps);
assert.match(text(tree), /Plan steps for this quiz/);
await nodes(tree).find(n => n.type === 'button' && text(n) === 'Plan the steps').props.onClick();
tree = planner.render(quizProps);
assert.match(text(tree), /template, not AI/);
assert.doesNotMatch(text(tree), /past exams|cheat sheet/);
const durations = nodes(tree).filter(n => /^Step \d+ duration$/.test(n.props?.['aria-label'] || ''));
assert.equal(durations.length, 3);
assert.equal(durations.reduce((sum, n) => sum + parseFloat(n.props.value), 0), 90);
planner.context.isDemoMode = false;
await nodes(tree).find(n => n.type === 'button' && text(n) === 'Plan the steps').props.onClick();
tree = planner.render(quizProps);
await nodes(tree).find(n => n.type === 'button' && text(n).includes('Yes')).props.onClick();
tree = planner.render(quizProps);
assert.doesNotMatch(text(tree), /Unscaled server fallback/);
assert.equal(nodes(tree).filter(n => /^Step \d+ duration$/.test(n.props?.['aria-label'] || '')).reduce((sum, n) => sum + parseFloat(n.props.value), 0), 90);
const futureProps = { ...props, task: { ...samples[2], subtasks: [], due_at: '2099-12-15' } };
planner.render(futureProps); tree = planner.render(futureProps);
nodes(tree).find(n => n.props?.placeholder === '+ Add a custom step...').props.onChange({ target: { value: 'Custom work' } });
tree = planner.render(futureProps);
nodes(tree).find(n => n.type === 'button' && text(n).trim() === 'Add').props.onClick();
tree = planner.render(futureProps);
assert.equal(find(tree, 'Step 1 start date').props.value, toVancouverDateString(new Date()));
assert.equal(find(tree, 'Step 1 do by date').props.value, '2099-12-15');

for (const name of ['AddTaskModal', 'QuickAddModal']) {
  const modal = await harness(name), p = { isOpen: true, onClose: () => {}, defaultCourse: 'CPSC 310' };
  modal.render(p); let t = modal.render(p);
  if (name === 'AddTaskModal') {
    const fields = nodes(t).find(n => n.props?.onTitleChange);
    fields.props.onTitleChange('One task'); fields.props.onDueChange('2099-12-15T23:59');
  } else {
    nodes(t).find(n => n.props?.id === 'quick-add-title').props.onChange({ target: { value: 'One task' } });
    nodes(t).find(n => n.props?.id === 'quick-add-course').props.onChange({ target: { value: 'CPSC 310' } });
    nodes(t).find(n => n.props?.id === 'quick-add-due-date').props.onChange({ target: { value: '2099-12-15T23:59' } });
  }
  let resolve: () => void = () => {}, count = 0;
  modal.context.addTask = () => { count++; return new Promise<void>(r => { resolve = r; }); };
  t = modal.render(p);
  const submit = nodes(t).find(n => n.type === 'form').props.onSubmit;
  const pending = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(count, 1, `${name}: same-render duplicate is blocked before rerender`);
  t = modal.render(p);
  assert.equal(nodes(t).find(n => n.props?.type === 'submit').props.disabled, true);
  assert.match(text(t), /Saving/);
  resolve(); await pending;
  modal.context.addTask = async () => { throw new Error('Simulated write failure'); };
  await nodes(modal.render(p)).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(nodes(modal.render(p)).find(n => n.props?.type === 'submit').props.disabled, false, `${name}: failure unlocks retry`);
}
console.log('Batch 20 regression checks passed');

for (const name of ['TasksList', 'Overview']) {
  const screen = await harness(name);
  screen.context.tasks = [task('2026-09-11')]; screen.context.now = frozen;
  const rendered = screen.render();
  assert.ok(nodes(rendered).some(n => ['h3', 'button'].includes(n.type) && /Next 7 days.*1/.test(text(n))), `${name}: seventh-day task appears in list and tile`);
}
