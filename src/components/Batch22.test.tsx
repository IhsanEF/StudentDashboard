import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

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

// Exercise real component handlers with controlled session, save and browser states.
async function harness(name: string, realModalFocus = false) {
  const values: any[] = [], deps: any[][] = [], cleanups: any[] = [];
  let index = 0, effects: (() => void)[] = [];
  const context: any = { tasks: [], courses: [], classes: [], exams: [], error: null, loading: false, isDemoMode: false,
    notifications: [], unreadNotificationCount: 0, notificationPrefs: { enabled: true }, refreshTasks: () => {},
    updateCourse: async () => {}, updateUiPrefs: () => {} };
  const hooks = { ...React, useContext: () => context,
    useState: (initial: any) => {
      const slot = index++;
      if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
    }, useRef: (initial: any) => { const slot = index++; return values[slot] ||= { current: initial }; },
    useMemo: (fn: any) => fn(), useEffect: (fn: any, next: any[] = []) => {
      const slot = index++;
      if (!deps[slot] || next.some((v, i) => v !== deps[slot][i])) {
        deps[slot] = next; effects.push(() => { cleanups[slot]?.(); cleanups[slot] = fn(); });
      }
    }
  };
  const env: any = { hooks, context, auth: { currentUser: { uid: 'test-user' } },
    pwa: { isIOS: false, isInstalled: false, isInstallable: false, install: async () => false } };
  const listeners = new Map<string, Set<any>>(), timers = new Map<number, () => void>();
  let timerId = 0;
  const window: any = { addEventListener: (name: string, fn: any) => {
    if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn);
  }, removeEventListener: (name: string, fn: any) => listeners.get(name)?.delete(fn) };
  const trigger: any = { focus: () => { document.activeElement = trigger; } };
  const document: any = { getElementById: () => trigger, activeElement: trigger, body: { style: { overflow: '' } }, ...window };
  const navigator = { userAgent: '', platform: '', maxTouchPoints: 0 };
  const confirmations: string[] = [];
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'], logLevel: 'silent', plugins: [{ name: 'batch22', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/hooks\/useViewMode|.*\/hooks\/usePWAInstall|.*\/auth|.*\/services\/errorReporter|.*\/CourseWeightingModal)$/ }, args => {
        if (args.kind === 'entry-point' || args.path.startsWith('firebase/') || (realModalFocus && args.path.endsWith('/useModalFocus'))) return;
        return { path: args.path, namespace: 'test' };
      });
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
        ? 'export default globalThis.hooks; export const {useState,useRef,useMemo,useEffect,useContext,useId}=globalThis.hooks;'
        : args.path.endsWith('/errorReporter') ? 'export const reportError=(error,context)=>globalThis.reports.push({error,...context});'
        : args.path.endsWith('/auth') ? 'export const auth=globalThis.auth,db={}; export const logout=()=>{},getAuthHeader=async()=>({});'
        : args.path.endsWith('/useTasks') ? 'export const TaskContext={}; export const useTasksContext=()=>globalThis.context;'
        : args.path.endsWith('/useViewMode') ? 'export const useViewMode=()=>({isDetailed:true});'
        : args.path.endsWith('/usePWAInstall') ? 'export const usePWAInstall=()=>globalThis.pwa;'
        : args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});'
        : 'export default "weight-modal";' }));
    } }] });
  env.reports = [];
  const module = { exports: {} as any }, store = { getItem: () => null, setItem: () => {} };
  new Function('module', 'exports', 'require', 'globalThis', 'window', 'document', 'navigator', 'localStorage', 'confirm', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), env, window, document, navigator, store,
    (message: string) => { confirmations.push(message); return false; },
    (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, (id: number) => timers.delete(id));
  return { context, env, navigator, document, confirmations, trigger,
    key: (key: string, shiftKey = false) => {
      let prevented = false;
      const event = { key, shiftKey, preventDefault: () => { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
      for (const fn of listeners.get('keydown') || []) fn(event);
      return prevented;
    },
    flushTimers: () => { for (const fn of timers.values()) fn(); timers.clear(); },
    render: (props: any = {}, modal?: any) => {
      index = 0;
      const component = module.exports.default || module.exports.PWAInstallButton;
      const tree = component(props);
      if (modal) { const dialog = nodes(tree).find(n => n.props?.role === 'dialog'); if (dialog) dialog.props.ref.current = modal; }
      const pending = effects; effects = []; pending.forEach(fn => fn()); return tree;
    }
  };
}
const course = { id: 'course', course_code: 'CPSC 310', course_name: 'Software Engineering', instructor: '', meeting_times: '',
  start_date: '', end_date: '', online_links: '', instructor_email: '', outline_url: '', other_links: '',
  grade_categories: [{ id: 'all', name: 'Work', weight: 100 }] };
const courses = await harness('CoursesList'); courses.context.courses = [course];
for (const [cause, expected] of [
  ['network unavailable', /reconnect.*Check your connection and retry/],
  ['permission-denied', /Sign out and back in/], ['Your session has ended', /Sign out and back in/],
  ['Cloud storage quota has been reached', /Try again later/], ['Cloud sync could not reconnect', /Try again/]
] as const) {
  courses.context.error = cause; assert.match(text(courses.render()), expected);
}
courses.context.error = null;
button(courses.render(), '1 grade categories (100%)').props.onClick();
const weights = () => nodes(courses.render()).find(n => n.type === 'weight-modal');
let calls = 0; courses.context.updateCourse = async () => { calls++; };
courses.env.auth.currentUser = null;
await assert.rejects(weights().props.onSave(course), /signed in/);
assert.equal(calls, 0, 'Expired auth never invokes a course write');
assert.match(weights().props.saveError, /Failed to save grade weights:.*Sign out and back in/);
courses.env.auth.currentUser = { uid: 'test-user' };
courses.context.updateCourse = async () => { calls++; throw Object.assign(new Error('Revoked session'), { code: 'permission-denied' }); };
await assert.rejects(weights().props.onSave(course), /Revoked session/);
assert.equal(courses.env.reports.at(-1).source, 'CoursesList.weights.save');
assert.ok(weights(), 'Write rejection preserves the open weight editor');
assert.match(weights().props.saveError, /Sign out and back in/);
const modal = await harness('CourseWeightingModal'); let closes = 0;
const modalProps = { isOpen: true, course, saveError: weights().props.saveError, onClose: () => closes++, onSave: weights().props.onSave };
modal.render(modalProps);
await nodes(modal.render(modalProps)).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
assert.equal(closes, 0);
assert.match(text(nodes(modal.render(modalProps)).find(n => n.props?.role === 'alert')), /Failed to save grade weights/);
assert.equal(button(modal.render(modalProps), 'Save Syllabus Weights').props.disabled, false);
courses.context.isDemoMode = true; courses.env.auth.currentUser = null; courses.context.updateCourse = async () => { calls++; };
await weights().props.onSave(course); assert.equal(weights(), undefined, 'Demo save remains functional');
courses.context.classes = [{ course_code: 'CPSC310' }, { course_code: 'MATH 100' }];
courses.context.exams = [{ course_code: 'CPSC 310' }]; courses.context.tasks = [{ task_id: 'work', course: 'cpsc310', type: 'assignment' }];
nodes(courses.render()).find(n => n.props?.['aria-label'] === 'More options for CPSC 310').props.onClick({ stopPropagation() {} });
await button(courses.render(), 'Delete').props.onClick();
const inlineConfirmation = nodes(courses.render()).find(n => n.props?.message?.startsWith?.('Delete CPSC 310?'));
assert.ok(inlineConfirmation);
assert.match(inlineConfirmation.props.message, /1 timetable classes, 1 exams and 1 tasks are kept/);
assert.match(inlineConfirmation.props.message, /warnings remain/);
assert.equal(courses.confirmations.length, 0, 'Course deletion never uses a native prompt');
let courseDeletes = 0;
courses.context.deleteCourse = async () => { courseDeletes++; };
inlineConfirmation.props.onCancel();
assert.equal(courseDeletes, 0);
assert.ok(!nodes(courses.render()).some(n => n.props?.message?.startsWith?.('Delete CPSC 310?')));
nodes(courses.render()).find(n => n.props?.['aria-label'] === 'More options for CPSC 310').props.onClick({ stopPropagation() {} });
button(courses.render(), 'Delete').props.onClick();
await nodes(courses.render()).find(n => n.props?.message?.startsWith?.('Delete CPSC 310?')).props.onConfirm();
assert.equal(courseDeletes, 1);
assert.ok(!nodes(courses.render()).some(n => n.props?.message?.startsWith?.('Delete CPSC 310?')));
console.log('Batch 22 courses: actionable causes, auth/write failures with visible open editor, demo success and linked deletion counts passed.');

// Batch 25: same-course snapshots preserve drafts; reopening seeds current weights.
const draft = await harness('CourseWeightingModal');
const draftProps = { isOpen: true, course, onClose() {}, onSave() {} };
draft.render(draftProps);
nodes(draft.render(draftProps)).find(n => n.type === 'input' && n.props.type === 'text').props.onChange({ target: { value: 'Typed draft' } });
const snapshotProps = { ...draftProps, course: { ...course, grade_categories: [{ id: 'all', name: 'Server update', weight: 100 }] } };
draft.render(snapshotProps);
assert.equal(nodes(draft.render(snapshotProps)).find(n => n.type === 'input' && n.props.type === 'text').props.value, 'Typed draft');
draft.render({ ...snapshotProps, isOpen: false });
draft.render(snapshotProps);
assert.equal(nodes(draft.render(snapshotProps)).find(n => n.type === 'input' && n.props.type === 'text').props.value, 'Server update');

const grades = await harness('GradesTab');
grades.context.tasks = [{ task_id: 'grade-work', course: 'TEST 100', type: 'assignment', status: 'Not Started' }];
nodes(grades.render()).find(n => n.props?.['aria-label'] === 'TEST 100 course details').props.onClick();
const autoCourse = () => nodes(grades.render()).find(n => n.props?.course?.id === 'auto-TEST100').props.course;
const initialAutoCourse = autoCourse();
grades.context.tasks = grades.context.tasks.map((t: any) => ({ ...t, status: 'Working' }));
assert.equal(autoCourse(), initialAutoCourse, 'Status snapshots reuse the synthesized course');
console.log('Batch 25 weighting drafts survive snapshots, reopen with current weights, and auto-course identity remains stable.');

const center = await harness('NotificationCenter');
let settings = 0, inbox = 0; const read: string[] = [], dismissed: string[] = [];
center.context.markNotificationAsRead = (id: string) => read.push(id); center.context.clearNotification = (id: string) => dismissed.push(id);
const notificationProps = { onOpenSettings: () => settings++, onOpenReviewInbox: () => inbox++, pendingReviewCount: 0 };
const openBell = () => nodes(center.render(notificationProps)).find(n => n.props?.id === 'notification-bell-btn').props.onClick();
openBell(); assert.match(text(center.render(notificationProps)), /Nothing yet.*a day before and an hour before.*Settings/);
nodes(center.render(notificationProps)).find(n => n.props?.id === 'open-notif-settings-btn').props.onClick();
assert.equal(settings, 1); assert.equal(nodes(center.render(notificationProps)).find(n => n.props?.id === 'notification-bell-btn').props['aria-expanded'], false);
for (const notification of [
  { id: 'new', action: 'open_review_inbox' }, { id: 'canvas_sync_123' }
]) {
  center.context.notifications = [{ ...notification, type: 'canvas_sync', title: 'Canvas Updates Found', body: 'Review Inbox', createdAt: new Date().toISOString(), read: false }];
  openBell(); const tree = center.render(notificationProps);
  button(tree, 'Open Review Inbox').props.onClick(); assert.equal(read.at(-1), notification.id);
  assert.equal(nodes(center.render(notificationProps)).find(n => n.props?.id === 'notification-bell-btn').props['aria-expanded'], false);
  openBell(); const dismiss = nodes(center.render(notificationProps)).find(n => n.props?.['aria-label'] === 'Dismiss notification');
  assert.match(dismiss.props.className, /opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100/);
  dismiss.props.onClick(); assert.equal(dismissed.at(-1), notification.id);
  openBell();
}
assert.equal(inbox, 2);
assert.doesNotMatch(readFileSync('src/TaskProvider.tsx', 'utf8'), /fetchAndSyncCanvasFeed/, 'Provider does not fetch retired feeds');
console.log('Batch 22 notifications: empty Settings action, new/legacy inbox navigation, read state and existing touch/focus dismissal passed.');

const pwa = await harness('PWAInstallButton', true); const pwaProps = { variant: 'compact' };
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
pwa.env.pwa.isIOS = true; pwa.navigator.userAgent = safari;
let tree = pwa.render(pwaProps); assert.match(tree.props.children?.[0]?.props.className || nodes(tree).find(n => n.type === 'button').props.className, /bg-\[#002145\].*text-white/);
nodes(tree).find(n => n.type === 'button').props.onClick();
const focusables: any[] = Array.from({ length: 2 }, () => ({ focus() { pwa.document.activeElement = this; }, getAttribute: () => '', textContent: 'Got It' }));
const dialog = { contains: (el: any) => focusables.includes(el), querySelector: () => null, querySelectorAll: () => focusables };
tree = pwa.render(pwaProps, dialog); pwa.flushTimers(); assert.equal(pwa.document.activeElement, focusables[0]);
assert.match(text(tree), /Offline access depends on what your browser has cached/); assert.doesNotMatch(text(tree), /instant offline/);
pwa.document.activeElement = focusables[1]; assert.equal(pwa.key('Tab'), true); assert.equal(pwa.document.activeElement, focusables[0]);
assert.equal(pwa.key('Tab', true), true); assert.equal(pwa.document.activeElement, focusables[1]);
assert.equal(pwa.key('Escape'), true); tree = pwa.render(pwaProps); assert.ok(!nodes(tree).some(n => n.props?.role === 'dialog'));
assert.equal(pwa.document.activeElement, pwa.trigger, 'Close restores trigger focus');
assert.equal(pwa.document.body.style.overflow, '');
for (const ua of [safari.replace('Version/18.0', 'CriOS/120'), safari.replace('Version/18.0', 'FxiOS/120'), safari.replace('Version/18.0', 'EdgiOS/120'), safari + ' Instagram', safari.replace(' Safari/604.1', '')]) {
  pwa.navigator.userAgent = ua; tree = pwa.render({ variant: 'outline' });
  assert.ok(!nodes(tree).some(n => n.type === 'button'), 'Non-Safari iOS browsers/webviews cannot open Safari instructions');
  assert.match(text(tree), /Open this page|Share \/ Add to Home Screen/);
}
pwa.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
// Even stale isIOS=true cannot turn an Android browser into iOS Safari.
tree = pwa.render({ variant: 'outline' }); assert.match(text(tree), /browser menu → Install app/); assert.doesNotMatch(text(tree), /iPhone|iPad|Safari/);
pwa.navigator.userAgent = safari; pwa.env.pwa.isInstalled = true; assert.equal(pwa.render(pwaProps), null);
pwa.env.pwa.isInstalled = false; pwa.env.pwa.isInstallable = true; let installs = 0; pwa.env.pwa.install = async () => { installs++; return true; };
let installed = 0; tree = pwa.render({ ...pwaProps, onInstalled: () => installed++ }); await tree.props.onClick(); assert.equal(installs, 1); assert.equal(installed, 1);
console.log('Batch 22 PWA: Safari gating/contrast, real focus/Tab/Escape/restore, Android/stale-state and other iOS browsers/webviews, installed hiding and native prompt passed.');

const privacy = await harness('PrivacyModal'); tree = privacy.render({ isOpen: true, onClose() {} });
assert.match(text(tree), /About \/ Operator.*not affiliated.*United States/);
assert.match(text(tree), /billing tier has not been verified/); assert.doesNotMatch(text(tree), /not used to train Google|enterprise developer terms/);
assert.match(text(tree), /not encrypted.*Signing out does not clear all cached coursework.*remain after you close a normal browser window.*clear this site's data/);
assert.equal(privacy.render({ isOpen: false, onClose() {} }), null);
console.log('Batch 22 privacy: operator/non-affiliation/location disclosures, unverified tier and persistent unencrypted cache guidance passed.');
