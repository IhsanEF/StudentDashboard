import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { Task, DEFAULT_NOTIFICATION_PREFS, InAppNotification } from './types';
import { DEMO_TASKS, DEMO_EXAMS, DEMO_CLASSES } from './demoData';
import { cleanForFirestore, normalizeTask, normalizeCourse, normalizeClassScheduleItem, normalizeExamItem } from './services/db';
import { formatInTimeZone, TIMEZONE, parseTaskDueDate } from './utils';
import {
  evaluateNotifications, generateDigestPreview, getFiredReminderKeys,
  loadSavedNotifications, updateSavedNotifications
} from './services/notificationService';

function storage() {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear()
  };
}
const local = storage();
const demoFinal = DEMO_TASKS.find(task => task.task_id === 'demo-cpsc-final')!;
const timetableFinal = DEMO_EXAMS.find(exam => exam.course_code === 'CPSC 310')!;
assert.equal(formatInTimeZone(parseTaskDueDate(demoFinal.due_at)!, TIMEZONE, 'yyyy-MM-dd HH:mm'),
  `${timetableFinal.date} ${timetableFinal.start_time}`, 'Final task and timetable use the same Vancouver wall time');
assert.ok(DEMO_CLASSES.filter(item => item.course_code === 'ENGL 112')
  .every(item => item.start_time === '12:00' && item.end_time === '13:30'));
Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
const now = new Date('2026-10-04T22:35:00Z'); // Sunday 3:35 PM in Vancouver
const task = (id: string, due: string): Task => ({
  task_id: id, title: `Assignment ${id}`, course: 'CPSC 310', type: 'assignment',
  due_at: due, status: 'Working', check_again_at: '', canvas_url: '', summary: '',
  source_message_id: '', last_email_at: '', needs_review: false, points_earned: '90',
  points_possible: '100', grade_text: 'A', feedback: 'PRIVATE FEEDBACK',
  progress_notes: '', next_action: '', last_interaction_at: ''
});
const tasks = Array.from({ length: 5 }, (_, i) => task(`task-${i}`, new Date(now.getTime() + (30 + i) * 60000).toISOString()));
const prefs = {
  ...DEFAULT_NOTIFICATION_PREFS,
  quietHours: { ...DEFAULT_NOTIFICATION_PREFS.quietHours, enabled: false },
  digests: { dailyMorning: true, weeklySunday: true }
};
const first = evaluateNotifications({ tasks, prefs, userId: 'entry', currentNotifications: [], now,
  firstEvaluation: true, sessionStartedAt: now.getTime() });
assert.equal(first.newNotifications.length, 1, 'Initial catch-up is capped at one reminder');
for (let i = 1; i <= 3; i++) {
  const again = evaluateNotifications({ tasks, prefs, userId: 'entry',
    currentNotifications: loadSavedNotifications('entry'), now: new Date(now.getTime() + i * 30000),
    sessionStartedAt: now.getTime() });
  assert.equal(again.newNotifications.length, 0, 'Reactive reevaluation cannot drain the initial burst');
}
const newThresholdTask = task('next-threshold', new Date(now.getTime() + 61 * 60000).toISOString());
const later = evaluateNotifications({ tasks: [newThresholdTask], prefs, userId: 'entry',
  currentNotifications: loadSavedNotifications('entry'), now: new Date(now.getTime() + 60000), sessionStartedAt: now.getTime() });
assert.equal(later.newNotifications.length, 1, 'Newly crossed thresholds still fire');
for (const date of ['2026-10-04T22:35:00Z', '2026-10-05T02:35:00Z']) {
  const evaluated = evaluateNotifications({ tasks, prefs: { ...prefs, leadTimes: [] }, userId: date,
    currentNotifications: [], now: new Date(date) });
  assert.equal(evaluated.newNotifications.length, 0, 'Old morning/evening digests never catch up outside their slot');
}
for (const [slot, type] of [['2026-10-04T15:00:30Z', 'daily_digest'], ['2026-10-05T01:00:30Z', 'weekly_digest']]) {
  const evaluated = evaluateNotifications({ tasks: [...tasks, task('next-week', '2026-10-06T22:00:00Z')], prefs: { ...prefs, leadTimes: [] }, userId: slot,
    currentNotifications: [], now: new Date(slot) });
  assert.equal(evaluated.newNotifications[0]?.type, type, 'Scheduled digest fires within its slot');
}
const notif = (id: string): InAppNotification => ({ id, type: 'test', title: id, body: '', createdAt: now.toISOString(), read: false });
// Tab B's stale array must never become the input to its next operation.
updateSavedNotifications('tabs', () => [notif('A')]);
const staleB: InAppNotification[] = [];
updateSavedNotifications('tabs', current => [notif('B'), ...current], staleB);
assert.deepEqual(loadSavedNotifications('tabs').map(n => n.id).sort(), ['A', 'B']);
updateSavedNotifications('tabs', current => current.map(n => n.id === 'A' ? { ...n, read: true } : n));
updateSavedNotifications('tabs', current => current.filter(n => n.id !== 'B'));
assert.deepEqual(loadSavedNotifications('tabs').map(n => [n.id, n.read]), [['A', true]]);
const setItem = local.setItem;
local.setItem = () => { throw new Error('quota'); };
const warn = console.warn;
console.warn = () => {};
evaluateNotifications({ tasks: [tasks[0]], prefs, userId: 'quota', currentNotifications: [], now });
console.warn = warn;
local.setItem = setItem;
assert.deepEqual(getFiredReminderKeys('quota'), {}, 'Failed notification persistence never marks a reminder fired');

// Exercise actual provider handlers/effects with controlled React hooks and Firebase subscriptions.
function hooks() {
  const slots: any[] = [];
  let index = 0;
  let dirty = false;
  let effects: (() => void)[] = [];
  const equal = (a: any[], b: any[]) => a?.length === b?.length && a.every((item, i) => Object.is(item, b[i]));
  const memo = (fn: () => any, deps: any[]) => {
    const i = index++;
    if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
    return slots[i].value;
  };
  const react = {
    lazy: () => 'lazy-component',
    Suspense: 'suspense',
    useState(initial: any) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (update: any) => {
        const next = typeof update === 'function' ? update(slots[i]) : update;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial: any) { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useMemo: memo,
    useCallback: (fn: any, deps: any[]) => memo(() => fn, deps),
    useEffect(fn: () => any, deps: any[]) {
      const i = index++;
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    createContext: (value: any) => ({ Provider: 'context', value }),
    useContext: (context: any) => context.value
  };
  return {
    react,
    render(fn: () => any) {
      let tree: any;
      let runs = 0;
      do {
        assert.ok(runs++ < 20, 'Effects settle');
        index = 0; dirty = false; tree = fn();
        const pending = effects; effects = []; pending.forEach(effect => effect());
      } while (dirty);
      return tree?.props?.value ?? tree;
    }
  };
}
const dbNames = readFileSync('src/TaskProvider.tsx', 'utf8').match(/import \{\s*syncUserProfile,([\s\S]*?)\} from '\.\/services\/db'/)![0]
  .match(/import \{([\s\S]*?)\}/)![1].split(',').map(name => name.trim()).filter(Boolean);
async function providerHarness(initialDemoMode: boolean, uid = 'real-user') {
  const h = hooks();
  const reports: any[] = [];
  const store = storage();
  const listeners = new Map<string, Set<(event: any) => void>>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let intervalId = 0;
  let timerNow = Date.now();
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  let subscriptions = 0;
  const collectionListeners = new Map<string, { success: any; failure: any }>();
  const confirmations: string[] = [];
  let confirmResult = true;
  let lastTree: any;
  let taskListener: ((tasks: Task[], metadata: any) => void) | null = null;
  let taskError: ((error: any) => void) | null = null;
  let signedOut = 0;
  let exited = 0;
  const auth = { currentUser: { uid: 'real-user' } as { uid: string } | null };
  const services: Record<string, any> = Object.fromEntries(dbNames.map(name => [name, async () => {}]));
  Object.assign(services, { cleanForFirestore: (value: any) => cleanForFirestore(JSON.parse(JSON.stringify(value))), normalizeTask, normalizeCourse, normalizeClassScheduleItem, normalizeExamItem });
  services.fetchUserTasks = async () => tasks;
  services.fetchUserCourses = async () => [];
  services.restoreDashboardBackup = async () => ({ tasksRestored: 1 });
  services.INITIAL_SAMPLE_COURSES = [{ id: 'engl', course_code: 'ENGL 112', meeting_times: 'Tue / Thu 2:00 PM - 3:30 PM' }];
  services.fetchUserNotificationPrefs = async () => DEFAULT_NOTIFICATION_PREFS;
  services.fetchUserUiPrefs = async () => null;
  for (const name of dbNames.filter(name => name.startsWith('subscribe'))) services[name] = (_uid: string, success: any, failure: any) => { collectionListeners.set(name, { success, failure }); return () => {}; };
  services.subscribeToTasks = (_uid: string, success: any, failure: any) => {
    subscriptions++; taskListener = success; taskError = failure; return () => {};
  };
  const authModule = { auth, googleSignIn: async () => auth.currentUser, logout: async () => {
    signedOut++; store.clear(); auth.currentUser = null;
  } };
  const result = await build({ entryPoints: ['src/TaskProvider.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
    logLevel: 'silent', plugins: [{ name: 'controlled-provider', setup(build) {
      build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'mock-service' }));
      build.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'mock-service' }));
      build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, args => ({ path: args.path, namespace: 'mock-react' }));
      build.onLoad({ filter: /.*/, namespace: 'mock-react' }, args => ({ contents: args.path === 'react'
        ? `const r = globalThis.testReact; export default r; export const {useState,useEffect,useCallback,useMemo,useRef,createContext,useContext} = r;`
        : `export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';` }));
      build.onResolve({ filter: /\/services\/errorReporter$/ }, () => ({ path: 'reporter', namespace: 'mock-service' }));
      build.onResolve({ filter: /\/services\/db$/ }, () => ({ path: 'db', namespace: 'mock-service' }));
      build.onResolve({ filter: /^\.\/auth$|^\.\.\/auth$/ }, () => ({ path: 'auth', namespace: 'mock-service' }));
      build.onLoad({ filter: /.*/, namespace: 'mock-service' }, args => ({ contents: args.path === 'db'
        ? dbNames.map(name => name === 'INITIAL_SAMPLE_COURSES' ? `export const ${name} = globalThis.testDb.${name};` : `export const ${name} = (...args) => globalThis.testDb.${name}(...args);`).join('\n')
        : args.path === 'reporter' ? `export const reportError=(error,context)=>globalThis.testReports.push({error,...context});`
        : args.path === 'firestore' ? `export class FieldValue {}`
        : args.path === 'icons' ? `export const AlertTriangle = () => null;`
        : `export const {auth,logout,googleSignIn} = globalThis.testAuth;` }));
    } }] });
  const module = { exports: {} as any };
  const windowMock = { localStorage: store, confirm: (message: string) => { confirmations.push(message); return confirmResult; }, addEventListener: (key: string, fn: any) => {
    if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn);
  }, removeEventListener: (key: string, fn: any) => listeners.get(key)?.delete(fn) };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: () => ({}),
    testReports: reports, testReact: h.react, testDb: services, testAuth: authModule,
    localStorage: store, window: windowMock, document: { ...windowMock, visibilityState: 'visible' },
    navigator: { onLine: true }, console: { ...console, error() {}, debug() {} }, URL, crypto: { randomUUID: () => 'test-tab' },
    Date: class extends Date { static now() { return timerNow; } },
    setInterval: (fn: () => void, ms: number) => { intervals.set(++intervalId, { fn, ms }); return intervalId; },
    clearInterval: (id: number) => intervals.delete(id),
    setTimeout: (fn: () => void, ms: number) => { timeouts.set(++intervalId, { fn, ms }); return intervalId; },
    clearTimeout: (id: number) => timeouts.delete(id)
  });
  const props = { children: null, initialDemoMode, user: { uid }, onDemoSignIn: (u: any) => { props.user = u; }, onLogout: () => { exited++; } };
  const render = () => h.render(() => { lastTree = module.exports.TaskProvider(props); return lastTree; });
  return { auth, reports, render, store, intervals, timeouts, services, confirmations,
    tree: () => lastTree, subscriptions: () => subscriptions, confirm: (value: boolean) => { confirmResult = value; },
    error: (err: any) => taskError!(err),
    emitCollection: (name: string, items: any[], metadata: any) => collectionListeners.get(name)!.success(items, metadata),
    errorCollection: (name: string, err: any) => collectionListeners.get(name)!.failure(err),
    manualCanvasSync: () => listeners.get('ubc:sync-canvas-feed')?.forEach(fn => fn({})),
    online: () => listeners.get('online')?.forEach(fn => fn({})),
    runRetry: () => { const entry = [...timeouts].find(([, t]) => t.ms >= 3000); assert.ok(entry, 'A retry is scheduled'); timeouts.delete(entry[0]); entry[1].fn(); },
    module: module.exports, emitTasks: (items: Task[], metadata = { fromCache: false, hasPendingWrites: false }) => taskListener!(items, metadata),
    deny: () => taskError!({ code: 'permission-denied' }), signedOut: () => signedOut, exited: () => exited,
    advanceTimer: (seconds: number) => { timerNow += seconds * 1000; },
    focus: () => listeners.get('focus')?.forEach(fn => fn({})),
    visible: () => listeners.get('visibilitychange')?.forEach(fn => fn({})),
    storageEvent: () => listeners.get('storage')?.forEach(fn => fn({ key: `ubc_inapp_notifications_${uid}` })) };
}
const demo = await providerHarness(true, 'demo-student');
let context = demo.render();
const snapshot = await context.exportFullBackup();
snapshot.tasks[0] = { ...snapshot.tasks[0], title: 'Restored title' };
for (let i = 0; i < 2; i++) { await context.restoreFullBackup(snapshot, 'merge'); context = demo.render(); }
for (const [key, id] of [['tasks', 'task_id'], ['courses', 'id'], ['classes', 'id'], ['exams', 'id']]) {
  assert.equal(context[key].length, snapshot[key].length, `Repeated ${key} merge does not duplicate IDs`);
  assert.equal(new Set(context[key].map((item: any) => item[id])).size, context[key].length);
}
assert.equal(context.tasks[0].title, 'Restored title');
context.triggerTestReminder(60); context = demo.render();
const reminder = context.notifications.find((n: InAppNotification) => n.id.startsWith('test_'));
assert.ok(reminder.title.startsWith('[TEST]') && reminder.body.startsWith('[TEST]'));
assert.equal(reminder.taskTitle, 'Sample Assignment (Test Notification)');
assert.ok(!context.tasks.some((t: Task) => t.task_id === reminder.taskId), 'Test reminders never attach a fabricated deadline to real coursework');
for (const type of ['daily', 'weekly']) {
  context.triggerDigest(type); context = demo.render();
  const digest = context.notifications.find((n: InAppNotification) => n.id.startsWith(`digest_test_${type}`));
  const preview = generateDigestPreview(type as 'daily' | 'weekly', context.tasks);
  assert.ok(digest.title.startsWith('[TEST]') && digest.title.includes(`(${preview.count} Deadlines)`));
  assert.ok(digest.body.includes(preview.summaryText));
}
context.startFocusTimer({ id: context.tasks[0].task_id, title: context.tasks[0].title, course: 'CPSC 310' });
context = demo.render();
const runningContext = context;
const persistedTimer = demo.store.getItem('ubc_active_focus_timer_demo_student');
for (let i = 0; i < 3; i++) { [...demo.intervals.values()].filter(timer => timer.ms === 1000).forEach(timer => timer.fn()); context = demo.render(); }
assert.equal(context, runningContext, 'Countdown ticks preserve the main context identity');
assert.equal(demo.store.getItem('ubc_active_focus_timer_demo_student'), persistedTimer, 'Countdown ticks do not write storage');
demo.advanceTimer(1501);
[...demo.intervals.values()].filter(timer => timer.ms === 1000).forEach(timer => timer.fn());
context = demo.render();
assert.ok(context.activeFocus.completed && !context.activeFocus.isRunning, 'Countdown completion changes timer state');
assert.equal(context.tasks[0].focus_sessions.length, 1, 'Completion logs exactly one session');
assert.equal(context.tasks[0].logged_minutes, 25);
context = demo.render();
assert.equal(context.tasks[0].focus_sessions.length, 1, 'Completion is idempotent');
// Batch 19: real timer handlers skip sub-30-second intervals and bound log amounts.
const timer = await providerHarness(true, 'demo-student');
let timerContext = timer.render();
const timerTask = timerContext.tasks[0];
for (const elapsed of [2, 29.9, 30, 90]) {
  timerContext.startFocusTimer({ id: timerTask.task_id, title: timerTask.title, course: timerTask.course });
  timerContext = timer.render();
  const beforeMinutes = timerContext.tasks[0].logged_minutes || 0;
  const beforeSessions = timerContext.tasks[0].focus_sessions?.length || 0;
  timer.advanceTimer(elapsed);
  await timerContext.stopAndLogFocusTimer(99999);
  timerContext = timer.render();
  assert.equal(timerContext.activeFocus, null, 'Finish always stops the countdown');
  assert.equal(timerContext.tasks[0].logged_minutes || 0, beforeMinutes + (elapsed < 30 ? 0 : Math.round(elapsed / 60)));
  assert.equal(timerContext.tasks[0].focus_sessions?.length || 0, beforeSessions + (elapsed < 30 ? 0 : 1));
}
console.log('Batch 19 provider short-session threshold and oversized timer log checks passed.');
demo.store.setItem('ubc_inapp_notifications_demo-student', JSON.stringify([notif('from-other-tab')]));
demo.storageEvent(); context = demo.render();
assert.ok(!context.notifications.some((n: InAppNotification) => n.id === 'from-other-tab'), 'Demo ignores persisted notifications from other tabs');
context.disableDemoMode(true);
await new Promise(resolve => setImmediate(resolve)); context = demo.render();
assert.equal(demo.signedOut(), 1); assert.equal(demo.exited(), 1);
assert.equal(context.tasks.length, 0);
assert.equal(demo.store.length, 0, 'Demo exit clears all app keys without recreating them');
assert.equal(demo.store.getItem('ubc_dashboard_auto_checkpoint_real-user'), null);

const real = await providerHarness(false);
context = real.render(); await Promise.resolve(); context = real.render();
real.emitTasks(tasks); context = real.render();
assert.equal(context.getLatestCheckpoint().tasks[0].feedback, 'PRIVATE FEEDBACK');
assert.equal(real.store.getItem('ubc_dashboard_auto_checkpoint_real-user'), null, 'Grades/feedback stay in memory, never localStorage');
context.enableDemoMode(); context = real.render();
assert.equal(context.getLatestCheckpoint(), null, 'Real checkpoints cannot cross into demo mode');
// A separate authenticated provider proves the subscription denial invokes the full logout path.
const denied = await providerHarness(false);
context = denied.render(); denied.emitTasks(tasks); context = denied.render();
denied.store.setItem('ubc_active_focus_timer', 'legacy timer');
denied.store.setItem('ubc_dashboard_auto_checkpoint_real-user', 'private grades');
denied.store.setItem('ubc_inapp_notifications_real-user', JSON.stringify([notif('private')]));
denied.deny(); await new Promise(resolve => setImmediate(resolve)); context = denied.render();
assert.equal(denied.signedOut(), 1, 'Permission denial signs out Firebase');
assert.equal(denied.exited(), 1); assert.equal(denied.store.length, 0);
assert.equal(context.getLatestCheckpoint(), null);

// Batch 6: exercise rejection, ownership, malformed imports, bounded retries and demo transitions.
function findNode(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}
const writes = await providerHarness(false);
let writeContext = writes.render(); await Promise.resolve(); writeContext = writes.render();
writes.emitTasks(tasks); writeContext = writes.render();
writes.services.updateFirestoreTask = async () => { throw Object.assign(new Error('rules'), { code: 'permission-denied' }); };
await assert.rejects(writeContext.updateTask(tasks[0].task_id, { title: 'Rejected title' }));
assert.equal(writes.reports.at(-1).source, 'TaskProvider.task.write');
writeContext = writes.render();
assert.match(writeContext.error, /validation/);
assert.equal(writeContext.tasks[0].title, tasks[0].title, 'Rejected writes roll back the optimistic task');
for (const metadata of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }, { fromCache: false, hasPendingWrites: false }]) {
  writes.emitTasks(tasks, metadata); writeContext = writes.render();
  assert.match(writeContext.error, /validation/, 'Snapshot and metadata changes cannot clear a rejected write notice');
}
assert.equal(writes.signedOut(), 0, 'A rejected write is validation feedback, not an expired session');
writes.services.updateFirestoreTask = async () => {};
await writeContext.updateTask(tasks[0].task_id, { title: 'Accepted' }); writeContext = writes.render();
assert.equal(writeContext.error, null, 'An acknowledged new write clears the old write notice');
const savedPrefs = writeContext.notificationPrefs;
writes.services.updateUserNotificationPrefs = async () => { throw new Error('rejected prefs'); };
await assert.rejects(writeContext.updateNotificationPrefs({ ...savedPrefs, maxPerDay: 2 }), /rejected prefs/);
writeContext = writes.render(); assert.equal(writeContext.notificationPrefs.maxPerDay, savedPrefs.maxPerDay);
let acknowledgePrefs: () => void = () => {};
writes.services.updateUserNotificationPrefs = () => new Promise<void>(resolve => { acknowledgePrefs = resolve; });
const pendingPrefs = writeContext.updateNotificationPrefs({ ...savedPrefs, maxPerDay: 2 });
writeContext = writes.render(); assert.equal(writeContext.notificationPrefs.maxPerDay, savedPrefs.maxPerDay, 'Pending writes never report acknowledged local prefs');
acknowledgePrefs(); await pendingPrefs; writeContext = writes.render(); assert.equal(writeContext.notificationPrefs.maxPerDay, 2);

let restores = 0;
writes.services.restoreDashboardBackup = async () => { restores++; return { tasksRestored: 1 }; };
const ownBackup = { version: '2.0', exportedAt: now.toISOString(), userId: 'real-user', tasks: [tasks[0]], courses: [] };
for (const sample of [snapshot, { ...ownBackup, userId: 'demo_student' }, { ...ownBackup, isDemo: true }, { ...ownBackup, tasks: [DEMO_TASKS[0]] }]) {
  await assert.rejects(writeContext.restoreFullBackup(sample), /Demo backups/);
}
assert.equal(restores, 0, 'Demo files cannot reach the real-account restore service');
writes.confirm(false);
await assert.rejects(writeContext.importFullBackup({ ...ownBackup, userId: 'other-account', data: ownBackup }), /cancelled/);
assert.equal(restores, 0);
assert.match(writes.confirmations[0], /different account/);
writes.confirm(true);
await writeContext.importFullBackup({ ...ownBackup, userId: 'other-account', notificationPrefs: { maxPerDay: 3 } });
writeContext = writes.render(); assert.equal(restores, 1);
assert.equal(writeContext.notificationPrefs.maxPerDay, 3, 'Real restore updates prefs immediately');
assert.equal(writeContext.notificationPrefs.channels.inApp, true);
let rawRestore: any;
writes.services.restoreDashboardBackup = async (_uid: string, value: any) => { rawRestore = value; return { tasksRestored: 1 }; };
await writeContext.restoreFullBackup({ ...ownBackup, classes: [null, { id: 'valid-later', course_code: 'CHEM 213' }] }, 'merge');
assert.equal(rawRestore.classes[0], null, 'Real restore delegates per-item failures to the database service');
assert.equal(rawRestore.classes[1].id, 'valid-later');

const malformedDemo = await providerHarness(true, 'demo-student');
let imported = malformedDemo.render();
const malformed = { version: '2.0', exportedAt: now.toISOString(), userId: 'demo_student',
  tasks: [{ task_id: 'custom', title: 42 }, { task_id: 'custom', title: 'Normalized title' }],
  courses: [{ id: 'custom-course', course_name: 10 }],
  classes: [{ id: 'custom-class', course_code: { invalid: true }, start_time: 42 }],
  exams: [{ id: 'custom-exam', title: ['invalid'], start_time: {} }], notificationPrefs: { enabled: true } };
await imported.restoreFullBackup(malformed, 'merge'); imported = malformedDemo.render();
assert.equal(imported.tasks.filter((t: Task) => t.task_id === 'custom').length, 1);
assert.equal(imported.tasks.find((t: Task) => t.task_id === 'custom').title, 'Normalized title');
assert.equal(imported.courses.find((c: any) => c.id === 'custom-course').course_name, 'Untitled Course');
assert.equal(imported.classes.find((c: any) => c.id === 'custom-class').course_code, 'General');
assert.equal(imported.exams.find((e: any) => e.id === 'custom-exam').title, 'Exam');
assert.ok(imported.notificationPrefs.channels && imported.notificationPrefs.quietHours && imported.notificationPrefs.digests);
const noUndefined = (value: any): boolean => value !== undefined && (value === null || typeof value !== 'object' || Object.values(value).every(noUndefined));
assert.ok([imported.tasks, imported.courses, imported.classes, imported.exams, imported.notificationPrefs].every(noUndefined));
await assert.rejects(imported.restoreFullBackup({ ...malformed, tasks: {} }), /must be an array/);
imported.triggerTestReminder(); imported = malformedDemo.render();
assert.equal(imported.notifications[0].dueAt, undefined, 'Test reminders do not invent a clock time');
assert.match(imported.notifications[0].body, /Example reminder/);
assert.equal(malformedDemo.store.getItem('ubc_inapp_notifications_demo_student'), null, 'Even manual demo reminders never persist');
assert.ok(![...malformedDemo.intervals.values()].some(timer => timer.ms === 30000), 'Demo skips automatic notification evaluation');

const retries = await providerHarness(false); retries.render();
for (let attempt = 0; attempt < 6; attempt++) {
  retries.error({ code: 'unavailable' }); retries.render(); retries.runRetry(); retries.render();
}
assert.equal(retries.subscriptions(), 7, 'Initial attachment plus at most six retry attachments');
retries.error({ code: 'unavailable' }); assert.equal(retries.reports.at(-1).source, 'TaskProvider.listener.tasks'); let retryContext = retries.render();
assert.match(retryContext.error, /retries are paused/);
assert.ok(![...retries.timeouts.values()].some(timer => timer.ms >= 3000));
retries.online(); retries.render(); assert.equal(retries.subscriptions(), 7, 'Online events do not restart exhausted retries');
const recovery = await providerHarness(false); recovery.render();
for (let attempt = 0; attempt < 5; attempt++) { recovery.error({ code: 'unavailable' }); recovery.render(); recovery.runRetry(); recovery.render(); }
recovery.emitTasks(tasks); recovery.render();
recovery.error({ code: 'unavailable' }); recovery.render();
assert.ok([...recovery.timeouts.values()].some(timer => timer.ms >= 3750 && timer.ms <= 6250), 'Server success resets backoff to the first attempt');
const quotaProvider = await providerHarness(false); quotaProvider.render();
quotaProvider.error({ code: 'resource-exhausted' }); const quotaContext = quotaProvider.render();
assert.match(quotaContext.error, /quota/);
assert.ok(![...quotaProvider.timeouts.values()].some(timer => timer.ms >= 3000));
quotaProvider.online(); quotaProvider.render(); assert.equal(quotaProvider.subscriptions(), 1);

const cachedRetry = await providerHarness(false); cachedRetry.render();
for (let attempt = 0; attempt < 6; attempt++) {
  cachedRetry.errorCollection('subscribeToCourses', { code: 'unavailable' }); cachedRetry.render();
  cachedRetry.runRetry(); cachedRetry.render();
  cachedRetry.emitCollection('subscribeToCourses', [], { fromCache: true, hasPendingWrites: false }); cachedRetry.render();
}
cachedRetry.errorCollection('subscribeToCourses', { code: 'unavailable' });
assert.match(cachedRetry.render().error, /retries are paused/, 'Cached snapshots cannot reset backoff indefinitely');
const otherQuota = await providerHarness(false); otherQuota.render();
otherQuota.errorCollection('subscribeToExams', { code: 'resource-exhausted' });
assert.match(otherQuota.render().error, /quota/, 'Quota failures from any dashboard listener are terminal and visible');

const demoExit = await providerHarness(false); let exitContext = demoExit.render();
demoExit.emitTasks(tasks); exitContext = demoExit.render();
exitContext.triggerTestReminder(); exitContext = demoExit.render();
const realHistory = demoExit.store.getItem('ubc_inapp_notifications_real-user');
exitContext.enableDemoMode(); exitContext = demoExit.render();
assert.equal(exitContext.notifications.length, 0);
exitContext.triggerTestReminder(); exitContext = demoExit.render();
assert.equal(demoExit.store.getItem('ubc_inapp_notifications_real-user'), realHistory, 'Demo never consumes real notification slots or writes real history');
demoExit.store.setItem('ubc_fired_reminders_demo_student', 'demo history');
demoExit.store.setItem('ubc_inapp_notifications_demo-student', 'legacy history');
exitContext.disableDemoMode(); exitContext = demoExit.render();
const exitDialog = findNode(demoExit.tree(), node => node.props?.role === 'dialog');
assert.ok(exitDialog && exitDialog.props['aria-modal'] && exitDialog.props['aria-labelledby']);
findNode(exitDialog, node => node.props?.id === 'leave-demo-stay-btn').props.onClick(); demoExit.render();
assert.equal(findNode(demoExit.tree(), node => node.props?.role === 'dialog'), null, 'Stay closes the dialog and retains edits');
exitContext = demoExit.render(); exitContext.disableDemoMode(true); await Promise.resolve(); exitContext = demoExit.render();
assert.equal(exitContext.isDemoMode, false); assert.equal(demoExit.signedOut(), 0, 'A signed-in demo exit returns to the real account');
assert.equal(demoExit.store.getItem('ubc_fired_reminders_demo_student'), null);
assert.equal(demoExit.store.getItem('ubc_inapp_notifications_demo-student'), null);
assert.equal(demoExit.store.getItem('ubc_inapp_notifications_real-user'), realHistory);
assert.ok(!exitContext.notifications.some((n: InAppNotification) => n.body.includes('demo')));

const keepDemo = await providerHarness(true, 'demo-student'); let keepContext = keepDemo.render();
await keepContext.addClassItem({ ...DEMO_CLASSES[0], id: 'my-class', course_code: 'MY COURSE' }); keepContext = keepDemo.render();
let kept: any;
keepDemo.services.restoreDashboardBackup = async (_uid: string, backup: any) => { kept = backup; return {}; };
keepContext.disableDemoMode(); keepDemo.render();
const keepButton = findNode(keepDemo.tree(), node => node.type === 'button' && node.props?.children === 'Sign in to keep this data');
await keepButton.props.onClick(); keepContext = keepDemo.render();
assert.equal(kept.tasks.length, 0, 'Sign-in keeps entered data without copying untouched demo tasks');
assert.equal(kept.classes.length, 1); assert.equal(kept.classes[0].id, 'my-class');
assert.equal(keepContext.isDemoMode, false); assert.equal(keepDemo.signedOut(), 0);

// Render and invoke the actual Settings handlers, including pending and red error feedback.
const settingsHooks = hooks();
const settingsContext: any = { ...writeContext, isDemoMode: false, getLatestCheckpoint: () => null };
let settingsClosed = 0;
let savedToast = 0;
settingsContext.showToast = () => { savedToast++; };
const settingsTimers = new Map<number, { fn: () => void; ms: number }>();
let settingsTimerId = 0;
const iconNames = readFileSync('src/components/SettingsModal.tsx', 'utf8').match(/import \{([^}]*)\} from 'lucide-react'/)![1].split(',').map(name => name.trim()).filter(Boolean);
const settingsBundle = await build({ entryPoints: ['src/components/SettingsModal.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'settings-mocks', setup(build) {
    build.onResolve({ filter: /^(react|react\/jsx-runtime|lucide-react|firebase\/auth|firebase\/firestore)$/ }, args => ({ path: args.path, namespace: 'settings-mock' }));
    build.onResolve({ filter: /^\.\.\/auth$|^\.\.\/hooks\/|^\.\/(DigestPreviewModal|ViewModeToggle|PWAInstallButton)$/ }, args => ({ path: args.path, namespace: 'settings-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'settings-mock' }, args => ({ contents:
      args.path === 'react' ? `const r = globalThis.hooks; export default r; export const {useState,useEffect,useRef} = r;`
      : args.path === 'react/jsx-runtime' ? `export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';`
      : args.path === 'lucide-react' ? iconNames.map(imported => { const name = imported.split(' as ')[0]; return `export const ${name} = '${name}';`; }).join('\n')
      : args.path === 'firebase/auth' ? `export const deleteUser = () => {};`
      : args.path === 'firebase/firestore' ? `export const doc = () => {}, deleteDoc = () => {}, writeBatch = () => {}, collection = () => {}, getDocs = () => {};`
      : args.path.endsWith('/auth') ? `export const auth = {currentUser:null}, db = {}, getAuthHeader = () => ({}), logout = () => {}, googleSignIn = () => {};`
      : args.path.endsWith('/useTasks') ? `export const useTasksContext = () => globalThis.context;`
      : args.path.endsWith('/useViewMode') ? `export const useViewMode = () => ({isDetailed:false});`
      : args.path.endsWith('/useModalFocus') ? `export const useModalFocus = () => ({modalRef:{current:null},handleBackdropClick:()=>{}});`
      : `export default 'component'; export const ViewModeToggle = 'view-toggle', PWAInstallButton = 'pwa';` }));
  } }] });
const settingsModule = { exports: {} as any };
runInNewContext(settingsBundle.outputFiles[0].text, { module: settingsModule, exports: settingsModule.exports,
  hooks: settingsHooks.react, context: settingsContext, console: { ...console, error() {} },
  window: { addEventListener() {}, removeEventListener() {} },
  setTimeout: (fn: () => void, ms: number) => { settingsTimers.set(++settingsTimerId, { fn, ms }); return settingsTimerId; },
  clearTimeout: (id: number) => settingsTimers.delete(id)
});
const settingsProps = { isOpen: true, user: { uid: 'real-user' }, onClose: () => { settingsClosed++; } };
const renderSettings = () => settingsHooks.render(() => settingsModule.exports.default(settingsProps));
let settingsTree = renderSettings();
let finishSettingsSave: () => void = () => {};
let rejectSettingsSave: (error: any) => void = () => {};
settingsContext.updateNotificationPrefs = () => new Promise<void>((resolve, reject) => { finishSettingsSave = resolve; rejectSettingsSave = reject; });
settingsTree = renderSettings();
const settingsSave = findNode(settingsTree, node => node.props?.id === 'save-settings-btn').props.onClick();
settingsTree = renderSettings();
assert.equal(findNode(settingsTree, node => node.props?.id === 'save-settings-btn').props.disabled, true);
assert.match(findNode(settingsTree, node => node.props?.role === 'status').props.children.flat().filter((item: any) => typeof item === 'string').join(' '), /waiting for cloud/);
[...settingsTimers.values()].find(timer => timer.ms === 10000)!.fn(); settingsTree = renderSettings();
assert.equal(settingsClosed, 0); assert.equal(savedToast, 0, 'Offline pending writes never show success');
rejectSettingsSave({ code: 'permission-denied', message: 'denied' }); await settingsSave; settingsTree = renderSettings();
const redFailure = findNode(settingsTree, node => node.props?.role === 'alert');
assert.ok(redFailure.props.className.includes('text-red-600'));
assert.match(redFailure.props.children.filter((item: any) => typeof item === 'string').join(''), /rejected by validation/);
assert.equal(settingsClosed, 0); assert.equal(savedToast, 0);
const settingsSuccess = findNode(settingsTree, node => node.props?.id === 'save-settings-btn').props.onClick();
finishSettingsSave(); await settingsSuccess; settingsTree = renderSettings();
assert.equal(settingsClosed, 1); assert.equal(savedToast, 1, 'Only acknowledged saves show success');
assert.equal(settingsTimers.size, 0, 'Pending timers are cleaned after settlement');

// Execute the real auth cleanup helper with Firebase mocks, including a reentrant auth callback.
const firebaseState = { cache: ['private record'], signOuts: 0, terminated: 0, cleared: 0, callback: () => {} };
const authStorage = storage();
authStorage.setItem('ubc_active_focus_timer', 'timer'); authStorage.setItem('ubc_dashboard_auto_checkpoint_uid', 'grades');
authStorage.setItem('ubc_inapp_notifications_uid', 'notifications'); authStorage.setItem('unrelated', 'keep');
const session = storage(); session.setItem('ubc_auth_redirect_pending', 'true');
const authBundle = await build({ entryPoints: ['src/auth.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'firebase-auth-mocks', setup(build) {
    build.onResolve({ filter: /^firebase\// }, args => ({ path: args.path, namespace: 'mock-firebase' }));
    build.onLoad({ filter: /.*/, namespace: 'mock-firebase' }, args => ({ contents: args.path === 'firebase/app'
      ? `export const initializeApp = () => ({}); export const onLog = () => {};`
      : args.path === 'firebase/auth'
        ? `export const getAuth = () => ({currentUser:{uid:'uid'}}); export class GoogleAuthProvider {};
           export const setPersistence = async () => {}; export const browserSessionPersistence = {}; export const browserLocalPersistence = {};
           export const signOut = async () => { globalThis.state.signOuts++; globalThis.state.callback(); };
           export const signInWithPopup = async () => null; export const signInWithRedirect = async () => {};
           export const signInWithEmailAndPassword = async () => null; export const sendPasswordResetEmail = async () => {};
           export const getRedirectResult = async () => null; export const onAuthStateChanged = () => () => {};`
        : `export const initializeFirestore = () => ({}); export const getFirestore = () => ({});
           export const persistentLocalCache = () => ({}); export const persistentMultipleTabManager = () => ({});
           export const doc = () => ({}); export const getDocFromCache = async () => ({});
           export const terminate = async () => { globalThis.state.terminated++; };
           export const clearIndexedDbPersistence = async () => { globalThis.state.cleared++; globalThis.state.cache = []; };` }));
  } }] });
const authExports = { exports: {} as any };
runInNewContext(authBundle.outputFiles[0].text, { module: authExports, exports: authExports.exports, state: firebaseState,
  window: { localStorage: authStorage, sessionStorage: session, location: { hostname: 'localhost' } }, localStorage: authStorage, sessionStorage: session, console });
firebaseState.callback = () => { void authExports.exports.logout('uid'); };
await authExports.exports.logout('uid');
assert.equal(firebaseState.signOuts, 1); assert.equal(firebaseState.terminated, 1); assert.equal(firebaseState.cleared, 1);
assert.equal(firebaseState.cache.length, 0); assert.equal(session.length, 0);
assert.equal(authStorage.length, 1); assert.equal(authStorage.getItem('unrelated'), 'keep');

// An auth failure after a successful session must use cleanup, not just hide the dashboard.
const appHooks = hooks();
let authSuccess: (user: any) => void = () => {};
let authFailure: () => void = () => {};
const cleanedUids: string[] = [];
const appAuth = {
  initAuth: (success: any, failure: any) => { authSuccess = success; authFailure = failure; return () => {}; },
  logout: async (uid: string) => { cleanedUids.push(uid); }
};
const appBundle = await build({ entryPoints: ['src/App.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'app-auth-mocks', setup(build) {
    build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, args => ({ path: args.path, namespace: 'mock-app' }));
    build.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: 'auth', namespace: 'mock-app' }));
    build.onResolve({ filter: /^\.\/components\// }, () => ({ path: 'component', namespace: 'mock-app' }));
    build.onResolve({ filter: /^\.\/TaskProvider$/ }, () => ({ path: 'provider', namespace: 'mock-app' }));
    build.onResolve({ filter: /^\.\/hooks\/useTasks$/ }, () => ({ path: 'tasks-context', namespace: 'mock-app' }));
    build.onLoad({ filter: /.*/, namespace: 'mock-app' }, args => ({ contents:
      args.path === 'tasks-context' ? 'export const useTasksContext = () => ({isDemoMode: true});' :
      args.path === 'react' ? `export const {useState,useEffect,useRef,lazy,Suspense} = globalThis.testReact;`
      : args.path === 'react/jsx-runtime' ? `export const jsx = (type, props) => ({type, props}); export const jsxs = jsx;`
      : args.path === 'auth' ? `export const {initAuth,logout} = globalThis.testAuth;`
      : args.path === 'provider' ? `export const TaskProvider = 'provider';`
      : `export default 'component';` }));
  } }] });
const appModule = { exports: {} as any };
runInNewContext(appBundle.outputFiles[0].text, { module: appModule, exports: appModule.exports,
  testReact: appHooks.react, testAuth: appAuth });
appHooks.render(() => appModule.exports.default());
authFailure();
assert.equal(cleanedUids.length, 0, 'Initial signed-out startup must not terminate the Firestore instance');
authSuccess({ uid: 'real-auth-session' }); appHooks.render(() => appModule.exports.default());
authFailure(); appHooks.render(() => appModule.exports.default());
assert.deepEqual(cleanedUids, ['real-auth-session'], 'Established auth failure clears caches and signs out');
console.log('Provider, notification, timer, auth and batch 6 regression checks passed.');

// Batch 10: controlled clock refresh, complete-list pruning, and delete rollback.
const clock = await providerHarness(true, 'demo-student');
let clockContext = clock.render();
const clockBefore = clockContext.now.getTime();
const syncBefore = clockContext.lastSync;
await clockContext.refreshTasks(); clockContext = clock.render();
assert.equal(clockContext.lastSync, syncBefore, 'Demo Refresh cannot claim a saved update');
clock.advanceTimer(60);
[...clock.intervals.values()].filter(timer => timer.ms === 60000).forEach(timer => timer.fn());
clockContext = clock.render(); assert.equal(clockContext.now.getTime(), clockBefore + 60000);
clock.advanceTimer(1); clock.focus(); clockContext = clock.render();
assert.equal(clockContext.now.getTime(), clockBefore + 61000, 'Focus refreshes the context clock immediately');
clock.advanceTimer(1); clock.visible(); clockContext = clock.render();
assert.equal(clockContext.now.getTime(), clockBefore + 62000, 'Returning to a visible tab refreshes immediately');
const pruned = await providerHarness(false);
let pruningContext = pruned.render();
const linked = { ...notif('linked'), taskId: tasks[0].task_id };
const orphan = { ...notif('orphan'), taskId: 'deleted' };
pruned.store.setItem('ubc_inapp_notifications_real-user', JSON.stringify([linked, orphan, notif('digest')]));
pruned.storageEvent(); pruningContext = pruned.render();
pruned.emitTasks([], { fromCache: true, hasPendingWrites: false }); pruningContext = pruned.render();
assert.equal(pruningContext.notifications.length, 3, 'An empty offline cache cannot remove reminders');
pruned.emitTasks(tasks); pruningContext = pruned.render();
assert.deepEqual(Array.from(pruningContext.notifications, (item: any) => item.id).sort(), ['digest', 'linked']);
assert.deepEqual(JSON.parse(pruned.store.getItem('ubc_inapp_notifications_real-user')!).map((item: any) => item.id).sort(), ['digest', 'linked'], 'Loaded task list also prunes persisted storage');
pruned.services.deleteFirestoreTask = async () => { throw new Error('rejected delete'); };
await assert.rejects(pruningContext.deleteTask(tasks[0].task_id)); pruningContext = pruned.render();
assert.ok(pruningContext.tasks.some((item: Task) => item.task_id === tasks[0].task_id));
assert.ok(pruningContext.notifications.some((item: any) => item.id === 'linked'), 'Rejected delete restores its reminders');
pruned.services.deleteFirestoreTask = async () => {};
await pruningContext.deleteTask(tasks[0].task_id); pruningContext = pruned.render();
assert.deepEqual(Array.from(pruningContext.notifications, (item: any) => item.id), ['digest']);
console.log('Batch 10 clock, demo refresh and notification pruning checks passed.');

// Batch 17: shared course edits persist in demo memory and never write to Firestore.
const courseDemo = await providerHarness(true, 'demo-student');
let courseContext = courseDemo.render();
let courseWrites = 0;
courseDemo.services.saveFirestoreCourse = async () => { courseWrites++; };
const editedDemoCourse = { ...courseContext.courses[0], credits: 6,
  grade_categories: [{ id: 'final', name: 'Final Exam', weight: 100 }] };
await courseContext.updateCourse(editedDemoCourse); courseContext = courseDemo.render();
assert.equal(courseContext.courses.find((c: any) => c.id === editedDemoCourse.id).credits, 6);
assert.equal(courseContext.courses.find((c: any) => c.id === editedDemoCourse.id).grade_categories[0].weight, 100);
assert.equal((await courseContext.exportFullBackup()).courses.find((c: any) => c.id === editedDemoCourse.id).credits, 6);
assert.equal(courseWrites, 0);
const shell = normalizeCourse({ id: 'auto-TEST101', course_code: 'TEST 101', credits: 4 }, 'auto-TEST101');
await courseContext.updateCourse(shell); courseContext = courseDemo.render();
assert.equal(courseContext.courses.find((c: any) => c.course_code === 'TEST 101').id, 'course-test101');
await courseContext.updateCourse({ ...shell, grade_categories: [{ id: 'quiz', name: 'Quiz', weight: 100 }] });
courseContext = courseDemo.render();
assert.equal(courseContext.courses.filter((c: any) => c.course_code === 'TEST 101').length, 1);
const courseReal = await providerHarness(false); courseReal.render();
courseReal.services.saveFirestoreCourse = async (uid: string, saved: any) => {
  assert.equal(uid, 'real-user'); assert.equal(saved.credits, 4); courseWrites++;
};
await courseReal.render().updateCourse(shell);
assert.equal(courseWrites, 1);
await assert.rejects(() => courseReal.render().updateCourse({ ...shell, id: 'fictional-example' }), /Sample courses/);
courseReal.services.saveFirestoreCourse = async () => { throw new Error('Denied'); };
await assert.rejects(() => courseReal.render().updateCourse({ ...shell, credits: 7 }), /Denied/);
assert.equal(courseReal.render().courses.find((c: any) => c.course_code === 'TEST 101').credits, 4, 'Failed persistence does not change React state');
console.log('Batch 17 shared demo course memory, stable shell IDs, credits and persistence guards passed.');

// Background sync failures must reach production telemetry even when caught locally.
const telemetrySync = await providerHarness(false);
telemetrySync.services.fetchUserNotificationPrefs = async () => ({ ...DEFAULT_NOTIFICATION_PREFS,
  savedCalendarFeedUrl: 'https://canvas.ubc.ca/feeds/calendars/user_test.ics', autoSyncCalendar: true });
(telemetrySync.auth.currentUser as any).getIdToken = async () => { throw new Error('Expired background sync session'); };
telemetrySync.render(); await new Promise(resolve => setImmediate(resolve)); telemetrySync.render();
telemetrySync.emitTasks(tasks); telemetrySync.render();
telemetrySync.manualCanvasSync(); await new Promise(resolve => setImmediate(resolve));
assert.ok(telemetrySync.reports.some(report => report.source === 'TaskProvider.canvas.backgroundSync'));
console.log('Caught background Canvas sync emits source-tagged telemetry.');
