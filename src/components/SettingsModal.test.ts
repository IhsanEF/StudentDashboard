import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { DEFAULT_NOTIFICATION_PREFS } from '../types';

// Exercise the real component handlers with controlled hooks, permissions and HTTP responses.
const bundle = await build({ entryPoints: ['src/components/SettingsModal.tsx'], bundle: true,
  write: false, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [{ name: 'settings-boundaries', setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime|firebase\/.*|lucide-react)$|\/auth$|\/hooks\/|\/services\/notificationService$|\/utils$|\.\/(DigestPreviewModal|PWAInstallButton|ViewModeToggle)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
      const contents = path === 'react' ? 'export const {useState,useEffect,useRef} = globalThis.hooks; export default globalThis.hooks;'
        : path === 'react/jsx-runtime' ? "export const jsx = (type,props) => ({type,props}); export const jsxs = jsx; export const Fragment = 'fragment';"
        : path.endsWith('/useTasks') ? 'export const useTasksContext = () => globalThis.context;'
        : path.endsWith('/useViewMode') ? 'export const useViewMode = () => ({isDetailed:true});'
        : path.endsWith('/useModalFocus') ? 'export const useModalFocus = () => ({modalRef:{},handleBackdropClick:()=>{}});'
        : path === '../auth' ? "export const auth = {}; export const db = {}; export const getAuthHeader = async () => globalThis.authHeaders; export const logout = () => {}; export const googleSignIn = () => {};"
        : path.includes('firebase/auth') ? 'export const deleteUser = () => {};'
        : path.includes('firebase/firestore') ? 'export const doc = () => {}; export const deleteDoc = () => {}; export const writeBatch = () => {}; export const collection = () => {}; export const getDocs = () => {};'
        : path.includes('notificationService') ? "export const generateDigestPreview = () => ({subject:'',title:'',summaryText:'',tasks:[]});"
        : path.endsWith('/utils') ? "export const formatInTimeZone = () => ''; export const TIMEZONE = 'America/Vancouver'; export const parseLocalDate = () => null; export const isTaskAnnouncement = task => task.type === 'announcement';"
        : path === 'lucide-react' ? 'export const X=0,Bell=0,Clock=0,Moon=0,Sliders=0,Sparkles=0,Calendar=0,Check=0,AlertCircle=0,RefreshCw=0,User=0,CheckCircle2=0,Volume2=0,VolumeX=0,Smartphone=0,Copy=0,ExternalLink=0,RotateCw=0,Download=0,Upload=0,Database=0,Archive=0,History=0,AlertTriangle=0,FileSpreadsheet=0,Trash2=0,ShieldAlert=0;'
        : path.endsWith('/PWAInstallButton') ? 'export const PWAInstallButton = 0;'
        : path.endsWith('/ViewModeToggle') ? 'export const ViewModeToggle = 0;' : 'export default 0;';
      return { contents };
    });
  } }] });
function harness(permission: 'default' | 'denied' | 'unsupported' = 'default', demo = false) {
  let index = 0, dirty = false;
  const slots: any[] = [], effects: (() => void)[] = [], requests: any[] = [];
  let focused = '', jsonReads = 0, permissionRequests = 0, digestCalls = 0;
  let response: any = { ok: true, headers: { get: () => 'application/json' }, json: async () => { jsonReads++; return { feedToken: 'valid-token' }; } };
  const notification = permission === 'unsupported' ? undefined : { permission, requestPermission: async () => { permissionRequests++; return 'denied'; } };
  const context: any = { notificationPrefs: structuredClone(DEFAULT_NOTIFICATION_PREFS), tasks: [], courses: [], classes: [], exams: [], groups: [], isDemoMode: demo,
    getLatestCheckpoint: () => null, triggerDigest: () => { digestCalls++; }, triggerTestReminder: () => {}, showToast: () => {}, updateNotificationPrefs: async (prefs: any) => { context.notificationPrefs = prefs; } };
  const hooks = {
    useState(initial: any) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (update: any) => {
      const next = typeof update === 'function' ? update(slots[i]) : update; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
    }]; },
    useRef(initial: any) { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn: () => void, deps: any[]) { const i = index++; if (!slots[i] || !deps.every((value, j) => Object.is(value, slots[i][j]))) { slots[i] = deps; effects.push(fn); } }
  };
  const module = { exports: {} as any };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, hooks, context, Notification: notification,
    window: { ...(notification ? { Notification: notification } : {}), location: { origin: 'https://dashboard.test' }, addEventListener() {}, removeEventListener() {} },
    document: { getElementById: (id: string) => ({ focus: () => { focused = id; } }) }, URL, authHeaders: { Authorization: 'Bearer test-account' },
    FileReader: class { onload: any; readAsText(file: any) { this.onload({ target: { result: file.content } }); } },
    fetch: async (...args: any[]) => { requests.push(args); return response; }, setTimeout: () => 1, clearTimeout() {}, console: { ...console, error() {} } });
  let tree: any;
  const props = { isOpen: true, onClose() {}, user: null };
  const render = () => { let runs = 0; do { assert.ok(++runs < 10); index = 0; dirty = false; tree = module.exports.default(props); effects.splice(0).forEach(fn => fn()); } while (dirty); return tree; };
  const nodes = (): any[] => { const all: any[] = []; const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); all.push(node); walk(node.props?.children); }; walk(tree); return all; };
  const byId = (id: string) => nodes().find(n => n.props?.id === id);
  const text = () => JSON.stringify(tree);
  render();
  return { render, nodes, byId, text, context, props, requests, setResponse: (value: any) => { response = value; },
    get jsonReads() { return jsonReads; }, get permissionRequests() { return permissionRequests; }, get focused() { return focused; }, get digestCalls() { return digestCalls; } };
}
const h = harness();
for (const id of ['tab-notifications-btn', 'tab-calendar-btn', 'tab-backup-btn', 'tab-profile-btn']) {
  h.byId(id).props.onClick(); h.render(); assert.ok(h.byId('save-settings-btn'), `Footer Save is present on ${id}`);
}
h.byId('tab-notifications-btn').props.onClick(); h.render();
const timing = h.nodes().find(n => n.props?.children?.[0]?.props?.children === '15 min before');
assert.equal(timing.props['aria-pressed'], false); timing.props.onClick(); h.render();
assert.equal(h.nodes().find(n => n.props?.children?.[0]?.props?.children === '15 min before').props['aria-pressed'], true);
h.context.notificationPrefs = { ...h.context.notificationPrefs, lastCalendarSync: '2026-10-02T08:00:00Z', lastDailyDigestDate: '2026-10-02' };
h.render();
assert.equal(h.nodes().find(n => n.props?.children?.[0]?.props?.children === '15 min before').props['aria-pressed'], true,
  'Background provider writes preserve unsaved lead times');
const daily = h.nodes().find(n => n.type === 'input' && n.props.checked === false && n.props.onChange?.toString().includes('dailyMorning'));
daily.props.onChange(); h.render(); assert.equal(h.digestCalls, 0, 'Enabling a digest never dispatches it');
let prevented = false;
h.nodes().find(n => n.props?.role === 'tablist').props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true; } }); h.render();
assert.ok(prevented); assert.equal(h.focused, 'tab-calendar-btn'); assert.equal(h.byId('tab-calendar-btn').props['aria-selected'], true);
assert.equal(h.byId('settings-tab-panel').props['aria-labelledby'], 'tab-calendar-btn');
h.context.notificationPrefs = { ...h.context.notificationPrefs, savedCalendarFeedUrl: 'https://calendar.example/secret.ics', autoSyncCalendar: true };
h.render();
assert.equal(h.byId('canvas-calendar-url'), undefined, 'Settings cannot edit a removed integration');
assert.ok(!h.text().includes('secret.ics'), 'Legacy feed secrets are absent from rendered settings');
h.setResponse({ ok: true, headers: { get: () => 'text/html' }, json: () => { throw new Error('Must not parse SPA HTML'); } });
await h.byId('generate-calendar-token-btn').props.onClick(); h.render();
assert.equal(h.requests[0][1].method, 'POST'); assert.equal(h.requests[0][1].headers.Authorization, 'Bearer test-account');
assert.equal(h.jsonReads, 0); assert.ok(h.text().includes('unexpected response'));
assert.equal(h.byId('calendar-token-error-notice').props.role, 'alert');
assert.ok(h.byId('generate-calendar-token-btn').props.children.includes('Retry'));
h.setResponse({ ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Feed service down' }) });
await h.byId('generate-calendar-token-btn').props.onClick(); h.render(); assert.ok(h.text().includes('Feed service down'));
h.setResponse({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Please sign in again.' }) });
await h.byId('generate-calendar-token-btn').props.onClick(); h.render(); assert.ok(h.text().includes('Please sign in again.'));
h.setResponse({ ok: true, headers: { get: () => 'application/json' }, json: async () => { throw new SyntaxError('Invalid JSON'); } });
await h.byId('generate-calendar-token-btn').props.onClick(); h.render(); assert.ok(h.byId('calendar-token-error-notice'));
h.setResponse({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ feedToken: 'valid-token' }) });
await h.byId('generate-calendar-token-btn').props.onClick(); h.render(); assert.ok(h.byId('regenerate-calendar-token-btn'));
assert.ok(h.text().includes('not instantly'));
const demo = harness('default', true); demo.byId('tab-calendar-btn').props.onClick(); demo.render();
assert.equal(demo.requests.length, 0); assert.equal(demo.byId('generate-calendar-token-btn'), undefined); assert.ok(demo.text().includes('Sign in to your account'));
assert.ok(!demo.text().includes('not instantly'), 'Subscription timing is only shown once a feed exists');
for (const state of ['denied', 'unsupported'] as const) {
  const p = harness(state); const inputs = p.nodes().filter(n => n.type === 'input' && n.props['aria-label']?.startsWith('Browser Push'));
  assert.ok(inputs.every(n => n.props.disabled && !n.props.checked));
  const button = p.nodes().find(n => n.type === 'button' && n.props.children === (state === 'denied' ? 'Browser access blocked' : 'Browser notifications unavailable'));
  assert.ok(button.props.disabled); await button.props.onClick(); p.render(); assert.equal(p.permissionRequests, 0);
  assert.ok(p.text().includes(state === 'denied' ? 'Blocked in browser settings' : 'not supported'));
}
const denied = harness(); const grant = denied.nodes().find(n => n.type === 'button' && n.props.children === 'Grant browser access');
await grant.props.onClick(); denied.render(); assert.ok(denied.text().includes('Blocked in browser settings'));
console.log('Settings interactions, retired feed controls, permission feedback and calendar response checks passed.');

const backup = harness();
backup.byId('tab-backup-btn').props.onClick(); backup.render();
assert.ok(backup.text().includes('No local backup yet'));
assert.equal(backup.byId('recover-checkpoint-btn').props.disabled, true);
backup.context.getLatestCheckpoint = () => ({ exportedAt: '2026-10-02T08:00:00Z' }); backup.render();
assert.equal(backup.byId('recover-checkpoint-btn').props.disabled, false);
assert.ok(backup.text().includes('Last saved in this browser on'));
assert.ok(backup.byId('recover-checkpoint-btn').props.className.includes('dark:hover:bg-slate-700'));
backup.context.getLatestCheckpoint = () => null; backup.render();
assert.equal(backup.byId('recover-checkpoint-btn').props.disabled, true, 'Removing a checkpoint clears the saved date');
backup.context.downloadFullBackup = async () => ({ fileName: 'UBC_Dashboard_Backup_2026-10-02.json' }); backup.render();
await backup.byId('download-snapshot-btn').props.onClick(); backup.render();
assert.ok(backup.text().includes('Backup downloaded: UBC_Dashboard_Backup_2026-10-02.json'));
assert.equal(backup.byId('download-snapshot-success-notice').props.role, 'status');
backup.context.downloadFullBackup = async () => { throw new Error('Firestore read denied'); }; backup.render();
await backup.byId('download-snapshot-btn').props.onClick(); backup.render();
assert.ok(backup.text().includes('Firestore read denied')); assert.equal(backup.byId('download-snapshot-success-notice'), undefined);
const csvButton = () => backup.nodes().find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes('Export CSV'));
backup.context.exportToCSV = () => null; backup.render();
csvButton().props.onClick(); backup.render(); assert.ok(backup.text().includes('No tasks to export yet'));
backup.context.exportToCSV = () => ({ fileName: 'UBC_Tasks_2026-10-02.csv', taskCount: 2 }); backup.render();
csvButton().props.onClick(); backup.render(); assert.ok(backup.text().includes('Exported 2 tasks to UBC_Tasks_2026-10-02.csv'));
backup.context.exportToCSV = () => { throw new Error('Download blocked'); }; backup.render();
csvButton().props.onClick(); backup.render(); assert.ok(backup.text().includes('CSV export failed: Download blocked'));
const upload = backup.nodes().find(n => n.type === 'input' && n.props.type === 'file');
upload.props.onChange({ target: { files: [{ content: JSON.stringify({ version: '2.0', data: { tasks: [] } }) }], value: 'fixture.json' } }); backup.render();
// Batch 17: the preview counts coursework while preserving announcements in the backup payload.
const coursework = Array.from({ length: 10 }, (_, i) => ({ task_id: `task-${i}`, type: 'assignment' }));
upload.props.onChange({ target: { files: [{ content: JSON.stringify({ version: '2.0', data: {
  tasks: [...coursework, { task_id: 'notice', type: 'announcement' }]
} }) }], value: 'fixture.json' } }); backup.render();
const taskCountTile = backup.nodes().find(n => Array.isArray(n.props?.children)
  && n.props.children[1]?.props?.children === 'Tasks');
assert.equal(taskCountTile.props.children[0].props.children, 10);
console.log('Batch 17 backup preview excludes announcements from task counts.');
const strategy = (label: string) => backup.nodes().find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(label));
assert.ok(strategy('Replace All').props.className.includes('dark:text-slate-300'));
strategy('Replace All').props.onClick(); backup.render();
assert.ok(strategy('Merge (Safe)').props.className.includes('dark:text-slate-300'));
backup.byId('tab-profile-btn').props.onClick(); backup.render();
assert.ok(backup.text().includes('Where your data is saved')); assert.ok(backup.text().includes('Saved to your Google account'));
demo.byId('tab-profile-btn').props.onClick(); demo.render(); assert.ok(demo.text().includes('Demo only — nothing is saved'));
const testReminder = harness();
let reminderCalls = 0; testReminder.context.triggerTestReminder = (leadMinutes: number) => { assert.equal(leadMinutes, 60); reminderCalls++; }; testReminder.render();
testReminder.byId('test-reminder-btn').props.onClick(); testReminder.render();
assert.equal(reminderCalls, 1); assert.ok(testReminder.text().includes('Test reminder sent'));
assert.equal(testReminder.byId('reset-reminder-history-btn'), undefined);
assert.equal(testReminder.byId('test-1d-reminder-btn'), undefined);
console.log('Batch 8 backup availability, export feedback, retry, draft preservation and reminder interactions passed.');

// A backup must reject any failed Firestore read instead of downloading defaults as success.
const dbBundle = await build({ entryPoints: ['src/services/db.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', plugins: [{ name: 'backup-reads', setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$|^\.\.\/auth$/ }, args => ({ path: args.path, namespace: 'backup-boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'backup-boundary' }, ({ path }) => ({ contents: path === '../auth'
      ? 'export const db = {};'
      : `export const collection=()=>({}),doc=()=>({}),getDoc=(...a)=>globalThis.reads.getDoc(...a),getDocs=(...a)=>globalThis.reads.getDocs(...a);
         export const setDoc=()=>{},updateDoc=()=>{},deleteDoc=()=>{},deleteField=()=>{},onSnapshot=()=>{},serverTimestamp=()=>{},writeBatch=()=>{},runTransaction=()=>{},query=()=>{},where=()=>{},limit=()=>{};` }));
  } }] });
const readFailure = new Error('permission-denied');
const reads = { getDoc: async () => ({ exists: () => false }), getDocs: async () => ({ forEach() {} }) };
const dbModule = { exports: {} as any };
runInNewContext(dbBundle.outputFiles[0].text, { module: dbModule, exports: dbModule.exports, reads,
  console: { ...console, warn() {} }, URL, Date, setTimeout, clearTimeout });
const emptySnapshot = await dbModule.exports.createFullDashboardBackup('empty-account');
assert.equal(emptySnapshot.tasks.length, 0); assert.equal(emptySnapshot.courses.length, 0);
reads.getDoc = async () => { throw readFailure; };
await assert.rejects(dbModule.exports.createFullDashboardBackup('read-denied'), error => error === readFailure);
const fallback = await dbModule.exports.fetchUserNotificationPrefs('read-denied');
assert.equal(fallback.enabled, DEFAULT_NOTIFICATION_PREFS.enabled, 'Normal preference loads retain their existing fallback');
await assert.rejects(dbModule.exports.fetchUserUiPrefs('read-denied', true), error => error === readFailure);
reads.getDoc = async () => ({ exists: () => false });
reads.getDocs = async () => { throw readFailure; };
await assert.rejects(dbModule.exports.createFullDashboardBackup('read-denied'), error => error === readFailure);
console.log('Empty-account backup data and fail-closed Firestore backup reads passed.');
