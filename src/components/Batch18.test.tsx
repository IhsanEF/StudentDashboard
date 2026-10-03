import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { DEMO_TASKS } from '../demoData';
import { DEFAULT_NOTIFICATION_PREFS, Task } from '../types';
import { evaluateNotifications, getFiredReminderKeys, loadSavedNotifications, saveNotificationsToStorage, showBrowserNotification } from '../services/notificationService';

async function harness(name: string) {
  const values: any[] = [], deps: any[][] = [], writes: any[] = [];
  let index = 0, effects: (() => void)[] = [];
  const context: any = { tasks: [], now: new Date('2026-09-02T21:00:00Z'), notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
    updateNotificationPrefs: async (prefs: any) => { writes.push(prefs); context.notificationPrefs = prefs; }, updateTask: async () => {} };
  const hooks = { ...React, useState: (initial: any) => {
    const slot = index++;
    if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
    return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
  }, useRef: (initial: any) => { const slot = index++; return values[slot] ||= { current: initial }; },
  useMemo: (fn: any) => fn(), useEffect: (fn: any, next: any[]) => {
    const slot = index++;
    if (!deps[slot] || next.some((v, i) => v !== deps[slot][i])) { deps[slot] = next; effects.push(fn); }
  } };
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'], logLevel: 'silent', plugins: [{ name: 'batch18', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/EditTaskModal|.*\/TaskCard)$/ }, args => ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'react'
        ? 'export default globalThis.hooks; export const {useState,useRef,useMemo,useEffect}=globalThis.hooks;'
        : args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;'
        : args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});'
        : 'export default ()=>null;' }));
    } }] });
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', 'globalThis', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url), { hooks, context });
  return { context, writes, render: (props: any = {}) => {
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
const task = (id: string, due: string, hours = 2): Task => ({ ...DEMO_TASKS[0], task_id: id, title: id, due_at: due, status: 'Not Started', type: 'assignment', estimated_hours: hours });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const ui = await harness('WorkloadTab');
ui.context.tasks = [task('mon', '2026-09-07', 2.4), task('fri', '2026-09-11', 2.4), task('sun', '2026-09-13', 6), task('later', '2026-11-15', 4)];
let tree = ui.render();
assert.match(text(tree), /14.8h\s*across 4 tasks/);
assert.match(text(tree), /Next 11 weeks/);
const nextWeek = nodes(tree).find(n => n.type === 'button' && n.props['aria-label']?.startsWith('Next Week,'));
nextWeek.props.onClick(); tree = ui.render();
assert.equal(find(tree, nextWeek.props['aria-label']).props['aria-pressed'], true);
assert.match(text(tree), /Most of this week's 10.8h lands on Sunday \(6h\)/);
const sunday = nodes(tree).find(n => n.type === 'button' && n.props['aria-label']?.startsWith('Sunday 2026-09-13'));
sunday.props.onClick(); tree = ui.render(); assert.equal(find(tree, sunday.props['aria-label']).props['aria-pressed'], true);
assert.match(text(tree), /Tasks Due on Selected Day \(Sun 13\)/);
for (const b of nodes(tree).filter(n => n.type === 'button')) {
  assert.ok(b.props['aria-label'] || text(b).trim(), 'Every workload button has a name');
  assert.equal(nodes(b).slice(1).some(n => n.type === 'button' || n.props?.role === 'button'), false, 'No nested interactive buttons');
}
find(tree, 'Customize weekly workload threshold').props.onClick(); tree = ui.render();
const slider = () => find(ui.render(), 'Weekly workload threshold in hours');
for (let value = 16; value <= 25; value++) slider().props.onChange({ target: { value: String(value) } });
assert.equal(ui.writes.length, 0, 'Dragging never writes preferences');
assert.match(text(ui.render()), /< 13.8h Light/); assert.match(text(ui.render()), /13.8–<25h Moderate/);
slider().props.onPointerUp({ currentTarget: { value: '25' } }); await flush();
slider().props.onBlur({ currentTarget: { value: '25' } }); await flush(); assert.equal(ui.writes.length, 1);
slider().props.onChange({ target: { value: '26' } }); slider().props.onKeyUp({ key: 'ArrowRight', currentTarget: { value: '26' } }); await flush();
assert.equal(ui.writes.length, 2);
ui.context.notificationPrefs = { ...ui.context.notificationPrefs, workloadThresholdHours: 30 }; ui.render();
assert.equal(slider().props.value, 30, 'External preferences synchronize');
const modal = await harness('DigestPreviewModal');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const open = { isOpen: true, onClose: () => {}, tasks: [task('date only', today), task('timed', `${today}T12:00:00-07:00`)] };
tree = modal.render(open);
assert.ok(nodes(tree).find(n => n.props?.role === 'dialog' && n.props['aria-modal'] === 'true' && n.props['aria-labelledby'] === 'digest-preview-title'));
assert.ok(find(tree, 'Close digest preview')); assert.match(text(tree), /end of day/); assert.doesNotMatch(text(tree), /11:59 PM/); assert.match(text(tree), /12:00 PM/);
console.log('Batch 18 workload timeline, names, selection, legend, slider commits, advice and digest dialog/date rendering passed.');

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) || null,
  setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
const now = new Date('2026-09-02T21:00:00Z');
const tasks = Array.from({ length: 6 }, (_, i) => task(`task_${i}`, '2026-09-02T21:45:00Z'));
const prefs = { ...DEFAULT_NOTIFICATION_PREFS, enabled: true, leadTimes: [60, 180, 1440], maxPerDay: 5,
  channels: { inApp: true, push: false, email: false }, quietHours: { enabled: false, start: '23:00', end: '08:00' } };
const evaluate = (userId: string, overrides: any = {}) => evaluateNotifications({ tasks, prefs, userId, currentNotifications: [], now, ...overrides });
assert.equal(evaluate('cap').newNotifications.length, 5);
saveNotificationsToStorage('cap', []);
assert.equal(evaluate('cap', { now: new Date(now.getTime() + 30000) }).newNotifications.length, 0, 'Clear all cannot reset quota');
assert.equal(evaluate('crossed', { prefs: { ...prefs, maxPerDay: 2 }, tasks: tasks.slice(0, 1) }).newNotifications.length, 1);
assert.equal(evaluate('crossed', { prefs: { ...prefs, maxPerDay: 2 }, tasks: tasks.slice(0, 2) }).newNotifications.length, 1, 'Crossed leads count once per delivery');
assert.equal(evaluate('off', { prefs: { ...prefs, channels: { inApp: false, push: true, email: false } } }).newNotifications.length, 0);
assert.equal(loadSavedNotifications('off').length, 0); assert.ok(Object.keys(getFiredReminderKeys('off')).length > 0);
assert.equal(evaluate('off', { prefs: { ...prefs, maxPerDay: 6 } }).newNotifications.length, 1, 'Re-enabling in-app does not replay five push-only reminders');
storage.set('ubc_fired_reminders_prune', JSON.stringify({ remind_task_0_60: now.getTime() - 3 * 86400000, remind_removed_60: now.getTime(), remind_task_1_60: now.getTime(), digest_daily_old: now.getTime() - 3 * 86400000 }));
evaluate('prune', { prefs: { ...prefs, maxPerDay: 0 } });
assert.deepEqual(Object.keys(getFiredReminderKeys('prune')), ['remind_task_1_60']);
const dated = task('date', '2026-09-02');
assert.doesNotMatch(evaluate('date', { tasks: [dated] }).newNotifications[0].body, /11:59 PM/);
const morning = new Date('2026-09-02T15:00:00Z');
assert.equal(evaluate('late', { tasks: [dated], prefs: { ...prefs, leadTimes: [], digests: { dailyMorning: true, weeklySunday: false } } }).newNotifications.length, 0);
assert.equal(evaluate('morning', { tasks: [dated], now: morning, prefs: { ...prefs, leadTimes: [], digests: { dailyMorning: true, weeklySunday: false } } }).newNotifications.length, 1);
assert.equal(evaluate('morningoff', { tasks: [dated], now: morning, prefs: { ...prefs, leadTimes: [], channels: { inApp: false, push: true, email: false }, digests: { dailyMorning: true, weeklySunday: false } } }).newNotifications.length, 0);
assert.equal(loadSavedNotifications('morningoff').length, 0); assert.ok(getFiredReminderKeys('morningoff')['digest_daily_2026-09-02']);
const tags: string[] = [];
Object.defineProperty(globalThis, 'window', { configurable: true, value: { Notification: {} } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
Object.defineProperty(globalThis, 'Notification', { configurable: true, value: class {
  static permission = 'granted'; constructor(_title: string, opts: any) { tags.push(opts.tag); }
} });
for (const taskId of ['first', 'second']) await showBrowserNotification('reminder', 'body', { taskId, leadMin: 60 });
await showBrowserNotification('digest', 'body', { tag: 'ubc-digest-daily-2026-09-02' });
assert.equal(new Set(tags).size, 3);
console.log('Batch 18 reminder channel, durable daily cap, crossed leads, pruning, date-only bodies, distinct push tags and scheduled digest checks passed.');

// Batch 28: distinguish weeks without deadlines from populated workload bands.
const summary = await harness('WorkloadSummaryCard');
for (const component of [summary, ui]) {
  component.context.tasks = [];
  const emptyTree = component.render();
  const emptyBadges = nodes(emptyTree).filter(n => n.type === 'span' && text(n) === 'Nothing scheduled');
  assert.equal(emptyBadges.length, 2);
  assert.ok(emptyBadges.every(n => n.props.className.includes('bg-slate-100')));
  assert.match(text(emptyTree), /No deadlines imported for this week yet — import a syllabus to see your real load/);
}
for (const [hours, label] of [[2, 'Light'], [10, 'Moderate'], [20, 'Crunch']] as const) {
  summary.context.tasks = [task('this-week', new Date().toISOString(), hours),
    task('next-week', new Date(Date.now() + 7 * 86400000).toISOString(), hours)];
  ui.context.now = new Date();
  ui.context.notificationPrefs.workloadThresholdHours = 15;
  ui.context.tasks = summary.context.tasks;
  ui.render();
  for (const component of [summary, ui]) {
    const view = component.render();
    assert.ok(nodes(view).filter(n => n.type === 'span' && text(n).trim() === label).length >= 2);
    assert.doesNotMatch(text(view), /Manageable|Heavy|heavy week/);
    assert.doesNotMatch(text(view), /Nothing scheduled/);
  }
}
summary.context.tasks = [task('undated', '', 2)];
assert.equal(nodes(summary.render()).filter(n => n.type === 'span' && text(n) === 'Nothing scheduled').length, 2);
let destination = '';
nodes(summary.render({ onNavigate: (tab: string) => destination = tab })).find(n => n.type === 'button' && text(n) === 'See the week').props.onClick();
assert.equal(destination, 'Workload');
console.log('Batch 28 empty-week badges, undated coursework, workload bands and navigation passed.');
