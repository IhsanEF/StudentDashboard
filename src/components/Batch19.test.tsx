import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { DEMO_TASKS } from '../demoData';
import { calculateCourseGrade } from '../services/gradeCalculatorService';
import { Course } from '../types';
import { readFileSync } from 'node:fs';
async function harness(name: string) {
  const values: any[] = [], deps: any[][] = [], writes: any[] = [];
  let index = 0, effects: (() => void)[] = [];
  const context: any = { tasks: [], now: new Date('2026-09-02T21:00:00Z'), notificationPrefs: {},
    updateNotificationPrefs: async (prefs: any) => { writes.push(prefs); context.notificationPrefs = prefs; }, updateTask: async () => {} };
  const hooks = { ...React, useState: (initial: any) => {
    const slot = index++;
    if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
    return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
  }, useRef: (initial: any) => { const slot = index++; return values[slot] ||= { current: initial }; },
  useId: () => 'test-id', useMemo: (fn: any) => fn(), useEffect: (fn: any, next: any[]) => {
    const slot = index++;
    if (!deps[slot] || next.some((v, i) => v !== deps[slot][i])) { deps[slot] = next; effects.push(fn); }
  } };
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'], logLevel: 'silent', plugins: [{ name: 'batch19', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/hooks\/useViewMode|.*\/hooks\/useFocusTimer|.*\/auth|.*\/CourseWeightingModal|.*\/EditTaskModal|.*\/TaskCard)$/ }, args => ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
        ? 'export default globalThis.hooks; export const {useState,useRef,useMemo,useEffect,useId}=globalThis.hooks;'
        : args.path.endsWith('/auth') ? 'export const auth={currentUser:null,onAuthStateChanged:()=>()=>{}}; export const getOfflineCacheStatus=()=>"checking"; export const subscribeOfflineCacheStatus=()=>()=>{};'
        : args.path.endsWith('/useFocusTimer') ? 'export const useFocusTimerContext=()=>globalThis.context;'
        : args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;'
        : args.path.endsWith('/useViewMode') ? 'export const useViewMode=()=>({isDetailed:true});'
        : args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});'
        : 'export default ()=>null;' }));
    } }] });
  const module = { exports: {} as any };
  const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const document = { querySelectorAll: () => [], querySelector: () => null, body: {} };
  new Function('module', 'exports', 'require', 'globalThis', 'window', 'document', 'MutationObserver', 'localStorage', 'sessionStorage', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), { hooks, context }, { innerWidth: 1400 }, document,
    class { observe() {} disconnect() {} }, store, store);
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

const course: Course = { id: 'cpsc', course_code: 'CPSC 310', course_name: 'Software Engineering', instructor: '',
  meeting_times: '', start_date: '', end_date: '', online_links: '', instructor_email: '', outline_url: '', other_links: '', grade_categories: [
  { id: 'work', name: 'Assignments', weight: 65 }, { id: 'final', name: 'Final Exam', weight: 35 }
] };
const work = { ...DEMO_TASKS[0], task_id: 'work', title: 'Graded work', course: 'CPSC 310', type: 'assignment' as const,
  category_id: 'work', points_earned: '55', points_possible: '65' };
const result = calculateCourseGrade({ course, tasks: [work], includeWhatIfs: false });
const calc = await harness('FinalExamCalculatorCard');
let props = { courseResult: result, finalExamWeight: 35 };
let tree = calc.render(props);
assert.equal(nodes(tree).find(n => n.type === 'details').props.open, undefined, 'Calculator is collapsed by default');
assert.match(text(tree), /71.4%/, 'Uses exact banked points despite the rounded 84.6% course grade');
assert.equal(nodes(tree).filter(n => n.type === 'select').length, 1);
assert.equal(nodes(tree).filter(n => n.type === 'button').length, 0, 'Seven target chips are absent');
const weight = () => nodes(calc.render(props)).find(n => n.props?.id === 'test-id-final-weight-input');
weight().props.onChange({ target: { value: '40' } });
assert.match(text(calc.render(props)), /\(custom\)/);
weight().props.onChange({ target: { value: '' } });
assert.equal(weight().props.value, '', 'Clearing the string input stays empty');
assert.match(text(calc.render(props)), /71.4%/, 'Empty weight computes from the syllabus');
weight().props.onChange({ target: { value: '31' } });
props = { ...props, finalExamWeight: 40 }; calc.render(props);
assert.equal(weight().props.value, '40', 'A changed syllabus resets the override');
assert.match(text(calc.render(props)), /default from course syllabus/);

const card = await harness('CourseGradeDetailCard');
const invalidCourse = { ...course, grade_categories: [{ id: 'work', name: 'Assignments', weight: 120 }] };
const cardProps = { course: invalidCourse, tasks: [work, { ...work, task_id: 'announcement', title: 'Announcement should be absent', type: 'announcement' }], onUpdateCourse: () => {}, onEditTask: () => {} };
tree = card.render({ ...cardProps, course });
assert.match(text(tree), /You need 71.4% on the final/);
tree = card.render(cardProps);
assert.doesNotMatch(text(tree), /Announcement should be absent/);
assert.match(text(tree), /100.0% syllabus graded/);
assert.match(text(tree), /Total weight: 120%/);
assert.match(text(tree), /Weights total 120% — expected 100%/);
nodes(tree).find(n => n.type === 'button' && text(n).includes('Try scores')).props.onClick();
const earned = () => nodes(card.render(cardProps)).find(n => n.props?.id === 'whatif-earned-work');
const possible = () => nodes(card.render(cardProps)).find(n => n.props?.id === 'whatif-possible-work');
earned().props.onChange({ target: { value: '100' } });
possible().props.onChange({ target: { value: '10' } });
tree = card.render(cardProps);
assert.equal(earned().props.value, 100, 'Bonus marks survive editing');
assert.equal(earned().props['aria-invalid'], true);
assert.equal(earned().props.max, undefined, 'Bonus marks are not HTML-clamped');
assert.match(text(tree), /Earned exceeds total \(1000%\)/);
assert.ok(nodes(tree).some(n => n.props?.className?.includes('border-red-500')));
assert.match(text(tree), /1000.0%/, 'The over-100 projection and category average are displayed');
earned().props.onChange({ target: { value: '5' } });
assert.equal(earned().props['aria-invalid'], false);
console.log('Batch 19 weight coverage, announcement exclusion, bonus score interactions, collapsed calculator, exact 71.4%, blank fallback and syllabus resync passed.');

const floating = await harness('FloatingFocusTimer');
const calls: number[] = [];
floating.context.isDemoMode = true;
floating.context.stopAndLogFocusTimer = async (minutes: number) => { calls.push(minutes); };
floating.context.activeFocus = { taskId: 'work', taskTitle: 'Focus work', userId: 'demo_student', sessionId: 'short',
  durationSeconds: 1500, secondsLeft: 1498, loggedSeconds: 0, isRunning: false, mode: 'pomodoro' };
floating.api.setUserInitiatedFocus(true);
const finish = () => nodes(floating.render()).find(n => n.type === 'button' && text(n) === 'Finish & Log');
floating.render(); finish().props.onClick(); tree = floating.render();
assert.match(text(tree), /Less than 30 seconds elapsed/);
assert.ok(nodes(tree).find(n => n.props?.role === 'dialog' && n.props['aria-modal'] === 'true'));
const logInput = () => nodes(floating.render()).find(n => n.props?.id === 'log-effort-minutes-input');
assert.equal(logInput().props.disabled, true);
await nodes(tree).find(n => n.type === 'button' && text(n) === 'Stop without logging').props.onClick();
assert.deepEqual(calls, [0]);
assert.equal(floating.render(), null);
floating.context.activeFocus = { ...floating.context.activeFocus, sessionId: 'next', secondsLeft: 1440 };
floating.api.setUserInitiatedFocus(true); floating.render();
finish().props.onClick(); tree = floating.render();
logInput().props.onChange({ target: { value: '99999' } });
assert.equal(logInput().props.value, 480);
logInput().props.onChange({ target: { value: '-1' } });
assert.equal(logInput().props.value, 1);
logInput().props.onChange({ target: { value: '99999' } });
await nodes(floating.render()).find(n => n.type === 'button' && text(n) === 'Log & Stop').props.onClick();
assert.deepEqual(calls, [0, 480]);
floating.context.activeFocus = { ...floating.context.activeFocus, sessionId: 'complete', secondsLeft: 0, loggedSeconds: 1500, completed: true };
floating.api.setUserInitiatedFocus(true); floating.render(); finish().props.onClick(); tree = floating.render();
assert.match(text(tree), /Interval completed and logged/);
assert.ok(nodes(tree).find(n => n.type === 'button' && text(n) === 'Stop without logging'));
console.log('Batch 19 visible short/completed log dialogs, manual input bounds, zero-log stop, and subsequent session visibility passed.');

const offline = await harness('OfflineIndicator'); offline.context.isOnline = false;
// Named exports are evaluated through the same real component harness.
const offlineTree = offline.api.OfflineIndicator();
assert.doesNotMatch(offlineTree.props.className, /fixed|bottom-/);
assert.match(readFileSync('src/components/FloatingFocusTimer.tsx', 'utf8'), /bottom-\[calc\(5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
assert.match(readFileSync('src/components/DashboardLayout.tsx', 'utf8'), /\[body:has\(\[role=dialog\]:not\(#focus-log-dialog\)\)_&\]:hidden/);
console.log('Batch 19 inline offline indicator, timer safe-area offset and own-dialog visibility guard passed.');
