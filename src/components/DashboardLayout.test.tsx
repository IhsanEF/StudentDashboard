import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary from './ErrorBoundary';

// Exercise actual layout handlers and hook state without a Firebase session or network.
const layoutBundle = await build({ entryPoints: ['src/components/DashboardLayout.tsx'], bundle: true,
  write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [{ name: 'layout-boundaries', setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime|lucide-react)$|^\.\./ }, args => ({ path: args.path, namespace: 'boundary' }));
    b.onResolve({ filter: /^\.\// }, args => args.importer ? ({ path: args.path, namespace: 'boundary' }) : undefined);
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents:
      path === 'react' ? 'export const {useState,useEffect,useRef,lazy,Suspense} = globalThis.hooks; export default globalThis.hooks;'
      : path === 'react/jsx-runtime' ? "export const jsx = (type,props) => ({type,props}); export const jsxs = jsx; export const Fragment = 'fragment';"
      : path.endsWith('/useTasks') ? 'export const useTasksContext = () => globalThis.context;'
      : path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:{current:null}});'
      : path.endsWith('/auth') ? 'export const auth = globalThis.auth;'
      : path.endsWith('/types') ? "export const SIMPLE_TABS = ['Overview','Tasks','Courses','Grades']; export const MORE_TABS = ['Workload','Timetable','Groups','Progress','Announcements'];"
      : path.endsWith('/utils') ? "export const cn = (...args) => args.filter(Boolean).join(' '); export const formatInTimeZone = (date,zone,format) => globalThis.formatTime(date,format); export const TIMEZONE='America/Vancouver';"
      : path === 'lucide-react' ? 'export const LayoutDashboard=0,Flame=0,CheckSquare=0,BookOpen=0,TrendingUp=0,Award=0,Bell=0,Calendar=0,LogOut=0,Download=0,AlertTriangle=0,Sparkles=0,WifiOff=0,CloudUpload=0,Shield=0,Sliders=0,Users=0,Inbox=0,Menu=0,X=0,Smartphone=0,GraduationCap=0,ChevronDown=0,RotateCw=0,Plus=0,ArrowLeft=0;'
      : path.endsWith('/PWAInstallButton') ? "export const PWAInstallButton='pwa-install';"
      : path.endsWith('/OfflineIndicator') ? "export const OfflineIndicator='offline';"
      : path.endsWith('/ToastHost') ? "export const ToastHost='toast';"
      : path.endsWith('/ViewModeToggle') ? "export const ViewModeToggle='view-toggle';" : "export default 'component';"
    }));
  } }] });

function harness(code: string, context: any = {}, auth = { currentUser: null as any }) {
  let index = 0, dirty = false, focused = '', confirmResult = false;
  const slots: any[] = [], effects: (() => void)[] = [], confirmations: string[] = [];
  const listeners = new Map<string, Function>();
  const hooks = {
    useState(initial: any) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (update: any) => { const next = typeof update === 'function' ? update(slots[i]) : update;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial: any) { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn: () => void, deps: any[]) { const i = index++; if (!slots[i] || !deps.every((v,j) => Object.is(v,slots[i][j]))) { slots[i] = deps; effects.push(fn); } },
    lazy: () => 'lazy', Suspense: 'suspense'
  };
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, hooks, context, auth, console,
    formatTime: (date: Date, format: string) => format === 'h:mm a' ? '6:42 PM' : date.toISOString(),
    document: { getElementById: (id: string) => ({ focus() { focused = id; } }), addEventListener() {}, removeEventListener() {} },
    window: { scrollTo() {}, addEventListener: (key: string, fn: Function) => listeners.set(key, fn), removeEventListener() {},
      confirm: (message: string) => { confirmations.push(message); return confirmResult; },
      matchMedia: () => ({ matches: false }), navigator: { userAgent: 'Chrome' } }, navigator: { platform: 'Linux', maxTouchPoints: 0 } });
  let tree: any;
  const render = (fn: () => any) => { let runs = 0; do { assert.ok(++runs < 10); index = 0; dirty = false; tree = fn(); effects.splice(0).forEach(fn => fn()); } while (dirty); return tree; };
  const nodes = () => { const all: any[] = []; const walk = (n: any) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); all.push(n); walk(n.props?.children); }; walk(tree); return all; };
  return { module, render, nodes, auth, listeners, confirmations, setConfirm: (value: boolean) => { confirmResult = value; }, get focused() { return focused; } };
}
let logouts = 0, demoExits = 0, exports = 0, refreshes = 0;
const toasts: string[] = [];
const context: any = { now: new Date(), tasks: [{ task_id: 'review', needs_review: true }], lastSync: null, isDemoMode: true,
  isOnline: true, hasPendingWrites: false, uiPrefs: { viewMode: 'simple', seenViewNotice: true }, focusModeActive: false,
  disableDemoMode: () => { demoExits++; }, logout: () => { logouts++; }, showToast: ({message}: any) => { toasts.push(message); }, refreshTasks: () => { refreshes++; }, exportToCSV: () => { exports++; } };
const h = harness(layoutBundle.outputFiles[0].text, context);
const props: any = { activeTab: 'Overview', onTabChange: (tab: string) => { props.activeTab = tab; }, children: 'content', user: null };
const render = () => h.render(() => h.module.exports.default(props));
const textOf = (node: any): string => Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.props?.children) : node == null ? '' : String(node);
const button = (name: string) => h.nodes().find(n => n.type === 'button' && (n.props['aria-label'] === name || textOf(n) === name));
render();
assert.ok(h.nodes().some(n => n.props?.['aria-label'] === 'Demo data notice'));
assert.ok(JSON.stringify(h.nodes()).includes('Demo - not saved'));
const notice = h.nodes().find(n => n.props?.['aria-label'] === 'Demo data notice');
h.nodes().find(n => n.type === 'button' && textOf(n) === 'Got it').props.onClick(); render();
assert.ok(!h.nodes().some(n => n.props?.['aria-label'] === 'Demo data notice'));
button('More actions').props.onClick(); render();
assert.equal(button('More actions').props['aria-expanded'], true);
button('Refresh').props.onClick(); render(); assert.equal(refreshes, 1);
assert.equal(button('More actions').props['aria-expanded'], false);
const notificationCenter = h.nodes().find(n => n.props?.onOpenTaskDetails);
notificationCenter.props.onOpenTaskDetails('deleted-task'); render();
assert.equal(toasts.at(-1), 'This task no longer exists');
assert.ok(!h.nodes().some(n => n.props?.task?.task_id === 'deleted-task'));
notificationCenter.props.onOpenTaskDetails('review'); render();
const detailsBoundary = h.nodes().find(n => n.props?.fallbackTitle === 'Task details unavailable');
assert.ok(detailsBoundary); detailsBoundary.props.onReset(); render();
assert.ok(!h.nodes().some(n => n.props?.fallbackTitle === 'Task details unavailable'));
const skip = h.nodes().find(n => n.type === 'a');
assert.equal(skip.props.href, '#main-content');
assert.equal(h.nodes().find(n => n.type === 'main').props.id, 'main-content');
let prevented = false; skip.props.onClick({ preventDefault() { prevented = true; } });
assert.ok(prevented); assert.equal(h.focused, 'dashboard-content');
assert.ok(button('Sign out')); button('Export CSV').props.onClick(); assert.equal(exports, 1);
assert.ok(h.nodes().find(n => n.type === 'pwa-install'));
button('More actions').props.onClick(); render(); button('Leave demo').props.onClick(); render(); assert.equal(logouts, 0); assert.equal(demoExits, 0);
assert.ok(h.confirmations[0].includes('Demo data will be discarded'));
h.setConfirm(true); button('More actions').props.onClick(); render(); button('Leave demo').props.onClick(); render(); assert.equal(logouts, 1); assert.equal(demoExits, 0);
h.auth.currentUser = { uid: 'real-account' }; render();
button('More actions').props.onClick(); render(); button('Exit demo').props.onClick(); render(); assert.equal(demoExits, 1); assert.equal(logouts, 1);
button('More actions').props.onClick(); render();
assert.equal(button('Exit demo').props.title, 'Exit demo (data will be discarded)');
button('More actions').props.onClick(); render();
button('More navigation and settings options').props.onClick(); render();
button('Review Inbox (1)').props.onClick(); render();
assert.equal(h.nodes().find(n => n.props?.role === 'dialog'), undefined);
assert.ok(h.nodes().some(n => n.props?.isOpen === true && n.props?.onEditTask), 'Review row opens the inbox modal');
for (const tab of ['Workload','Timetable','Groups','Progress','Announcements']) {
  props.activeTab = tab; render(); const more = button(`${tab} (current), more options`);
  assert.equal(more.props['aria-current'], 'page');
  assert.equal(h.nodes().find(n => n.props?.id === 'global-live-region').props.children, `${tab} page`);
  more.props.onClick(); render();
  const selected = h.nodes().find(n => n.type === 'button' && n.props['aria-current'] === 'page' && n.props.className.includes('min-h-[50px]'));
  assert.ok(selected, 'Secondary tab marked current in More sheet');
  const primary = h.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'Overview' && n.props.className.includes('flex-col'));
  primary.props.onClick(); render(); assert.equal(props.activeTab, 'Overview');
}
context.isDemoMode = false; render();
assert.ok(JSON.stringify(h.nodes()).includes('Awaiting saved data'));
context.lastSync = new Date('2026-10-02T01:42:00Z') as any; render();
assert.ok(JSON.stringify(h.nodes()).includes('Last saved 6:42 PM'));
context.hasPendingWrites = true; render(); assert.ok(JSON.stringify(h.nodes()).includes('Saving...'));

// Every header overlay resets locally; provider state and layout children remain present.
context.closeImport = () => { context.isImportOpen = false; };
context.openImport = () => { context.isImportOpen = true; };
for (const [label, title] of [['Settings', 'Settings unavailable'], ['Privacy & AI', 'Privacy unavailable']] as const) {
  button(label).props.onClick(); render();
  const boundary = h.nodes().find(n => n.props?.fallbackTitle === title);
  assert.ok(boundary); boundary.props.onReset(); render();
  assert.ok(!h.nodes().some(n => n.props?.fallbackTitle === title));
}
button('Add or import').props.onClick(); render();
h.nodes().find(n => n.props?.role === 'menuitem' && textOf(n).includes('Add task')).props.onClick(); render();
const addBoundary = h.nodes().find(n => n.props?.fallbackTitle === 'Add task unavailable');
assert.ok(addBoundary); addBoundary.props.onReset(); render();
assert.ok(!h.nodes().some(n => n.props?.fallbackTitle === 'Add task unavailable'));
context.isImportOpen = true; render();
const importBoundary = h.nodes().find(n => n.props?.fallbackTitle === 'Import unavailable');
assert.ok(importBoundary); importBoundary.props.onReset(); render();
assert.equal(context.isImportOpen, false);
assert.ok(!h.nodes().some(n => n.props?.fallbackTitle === 'Import unavailable'));
const notificationBoundary = h.nodes().find(n => n.props?.fallbackTitle === 'Notifications unavailable');
notificationBoundary.props.onReset(); render();
assert.notEqual(h.nodes().find(n => n.props?.fallbackTitle === 'Notifications unavailable'), notificationBoundary);
assert.ok(h.nodes().some(n => n.props?.id === 'dashboard-content'), 'Local resets preserve dashboard content');

const hookBundle = await build({ entryPoints: ['src/hooks/usePWAInstall.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'hook-boundary', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const {useState,useEffect} = globalThis.hooks;' })); } }] });
for (const outcome of ['accepted','dismissed']) {
  const pwa = harness(hookBundle.outputFiles[0].text);
  const read = () => pwa.render(() => pwa.module.exports.usePWAInstall());
  read(); let prompts = 0;
  pwa.listeners.get('beforeinstallprompt')!({ preventDefault() {}, prompt: async () => { prompts++; }, userChoice: Promise.resolve({outcome}) });
  const ready = read(); assert.equal(ready.isInstallable, true); assert.equal(await ready.install(), outcome === 'accepted');
  const done = read(); assert.equal(done.isInstallable, false); assert.equal(done.isInstalled, outcome === 'accepted');
  assert.equal(await done.install(), false); assert.equal(prompts, 1, 'Consumed prompt cannot be reused');
}
for (const isDemoMode of [true, false]) {
  const boundary = new ErrorBoundary({ children: null, isDemoMode });
  boundary.state = { ...boundary.state, hasError: true, error: new Error('raw JavaScript failure') };
  const html = renderToStaticMarkup(boundary.render());
  assert.ok(html.includes("This part of the dashboard stopped working. Nothing you&#x27;ve saved has been lost."));
  assert.ok(!html.includes('<details') && !html.includes('raw JavaScript failure'));
  assert.ok(html.includes('Reset View') && html.includes('Reload App'));
}
console.log('Dashboard layout, demo exit routing, PWA prompt consumption and error disclosure checks passed.');

// Batch 25: reset changes the child key and the fallback exposes independent escapes.
let escapedToTasks = 0, signedOut = 0;
const recovery = new ErrorBoundary({ children: <span>Recovered view</span>, isDemoMode: false,
  onGoToTasks: () => escapedToTasks++, onSignOut: () => signedOut++ });
const childKey = (recovery.render() as React.ReactElement).key;
recovery.state = { ...recovery.state, hasError: true, error: new Error('Deterministic failure') };
const fallback = recovery.render();
const recoveryButtons = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] :
  [...(tree.type === 'button' ? [tree] : []), ...React.Children.toArray(tree.props?.children).flatMap(recoveryButtons)];
const fallbackButtons = recoveryButtons(fallback);
fallbackButtons.find(n => n.props.children === 'Go to Tasks').props.onClick();
fallbackButtons.find(n => n.props.children === 'Sign out').props.onClick();
assert.equal(escapedToTasks, 1); assert.equal(signedOut, 1);
recovery.setState = ((update: any) => { recovery.state = { ...recovery.state, ...update(recovery.state) }; }) as any;
fallbackButtons.find(n => renderToStaticMarkup(n).includes('Reset View')).props.onClick();
assert.equal(recovery.state.hasError, false);
assert.notEqual((recovery.render() as React.ReactElement).key, childKey);
console.log('Batch 25 error recovery remount and Tasks/sign-out escape handlers passed.');
