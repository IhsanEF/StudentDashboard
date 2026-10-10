import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DEMO_GROUPS, DEMO_GROUP_TASKS, DEMO_TASKS } from '../demoData';
import { INITIAL_SAMPLE_COURSES } from '../services/db';

// Exercise the real form handlers with isolated hooks, auth, and persistence.
// No credentials or live Firestore writes are required for these regressions.
async function harness(name: string, demo = false) {
  const values: any[] = [], deps: any[][] = [];
  let index = 0, copied = 0, selected = 0, confirmed = false, createCalls = 0;
  let createResult: any = DEMO_GROUPS[0], saveResult: any = undefined;
  const courseUpdates: any[] = [];
  const requests: any[] = [], imports: any[] = [], updates: any[] = [], deletes: any[] = [], saves: any[] = [];
  let result: any = { tasks: [], courses: [] };
  const hooks = { ...React,
    useState: (initial: any) => {
      const slot = index++;
      if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
    },
    useRef: (initial: any) => {
      const slot = index++;
      return values[slot] ||= { current: initial };
    },
    useEffect: (effect: any, next: any[] = []) => {
      const slot = index++;
      if (!deps[slot] || next.some((v, i) => v !== deps[slot][i])) { deps[slot] = next; effect(); }
    },
    useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn
  };
  const clipboard: any = { writeText: async () => { copied++; } };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/jpeg;base64,encoded' };
  const video = { videoWidth: 800, videoHeight: 600, play: async () => {} };
  const stream = { getTracks: () => [{ stop: () => {} }] };
  const environment = {
    reports: [] as any[], hooks, context: {
      isDemoMode: demo, tasks: [], courses: INITIAL_SAMPLE_COURSES,
      groups: DEMO_GROUPS, activeGroupId: DEMO_GROUPS[0].id, groupTasks: DEMO_GROUP_TASKS,
      notificationPrefs: {}, uiPrefs: { viewMode: 'detailed' }, showToast: () => {},
      setActiveGroupId: () => {},
      createGroup: async () => { createCalls++; if (createResult instanceof Error) throw createResult; return await createResult; },
      saveGroupTaskAction: async (_: string, task: any) => { saves.push(task); return await saveResult; },
      deleteGroupTaskAction: async (...args: any[]) => { deletes.push(args); },
      updateCourse: async (course: any) => { courseUpdates.push(course); },
      updateTask: async (...args: any[]) => { updates.push(args); }, addTask: async () => {}
    },
    auth: { currentUser: { uid: 'test-student', getIdToken: async () => 'test-token' } },
    batch: async (...args: any[]) => { imports.push(structuredClone(args)); },
    document: { createRange: () => ({ selectNodeContents: () => { selected++; } }), createElement: (tag: string) => tag === 'canvas' ? canvas : video },
    window: { confirm: () => confirmed, addEventListener: () => {}, removeEventListener: () => {}, getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }) },
    navigator: { clipboard, mediaDevices: { getUserMedia: async () => stream, getDisplayMedia: async () => stream } },
    localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    Image: class { width = 800; height = 600; onload: any; set src(_value: string) { queueMicrotask(() => this.onload()); } },
    FileReader: class { onload: any; readAsDataURL() { this.onload({ target: { result: 'data:image/gif;base64,original' } }); } }
  };
  const bundle = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react/jsx-runtime', 'firebase/*', 'lucide-react'], logLevel: 'silent', plugins: [{ name: 'batch16', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useModalFocus|.*\/auth|.*\/services\/errorReporter|.*\/services\/db|.*\/PrivacyModal)$/ }, args => ({ path: args.path, namespace: 'batch16' }));
      b.onLoad({ filter: /.*/, namespace: 'batch16' }, args => ({ contents:
        args.path === 'react' ? 'export default globalThis.hooks; export const {useState,useEffect,useMemo,useRef,useCallback}=globalThis.hooks;' :
        args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;' :
        args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});' :
        args.path.endsWith('/errorReporter') ? 'export const reportError=(error,context)=>globalThis.reports.push({error,...context});' :
        args.path.endsWith('/auth') ? 'export const auth=globalThis.auth; export const db={};' :
        args.path.endsWith('/PrivacyModal') ? 'export default ()=>null;' :
        'export const batchImportTasksAndCourses=globalThis.batch; export const saveFirestoreCourse=()=>{};' }));
    } }] });
  const module = { exports: {} as any };
  let responseStatus = 200;
  const fetchMock = async (url: string, options: any) => {
    if (url === '/api/health') return { json: async () => ({ aiAvailable: true }) };
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (result instanceof Error) throw result;
    return { ok: responseStatus < 400, status: responseStatus, headers: { get: () => 'application/json' }, json: async () => structuredClone(result) };
  };
  new Function('module', 'exports', 'require', 'globalThis', 'fetch', 'window', 'document', 'navigator', 'localStorage', 'Image', 'FileReader', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), environment, fetchMock, environment.window, environment.document,
    environment.navigator, environment.localStorage, environment.Image, environment.FileReader, () => 0, () => {});
  return { requests, imports, courseUpdates, updates, deletes, saves, environment,
    render: (props: any = {}) => { index = 0; return name === 'SyllabusImportModal' ? module.exports.SyllabusImportBody(props) : module.exports.default(props); },
    response: (data: any, status = 200) => { result = data; responseStatus = status; }, confirm: () => { confirmed = true; },
    clipboardFail: () => { clipboard.writeText = async () => { throw new Error('Denied'); }; }, clipboardMissing: () => { environment.navigator.clipboard = undefined; },
    clipboardCounts: () => ({ copied, selected }), create: (value: any) => { createResult = value; }, counts: () => createCalls,
    pendingSave: (value: any) => { saveResult = value; }, stateValues: () => values
  };
}
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  const children = Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children);
  for (const child of children) { const found = find(child, predicate); if (found) return found; }
}
const input = (tree: any, id: string) => find(tree, n => n.props?.id === id);
const button = (tree: any, label: string) => find(tree, n => n.type === 'button' && (n.props['aria-label'] === label || JSON.stringify(n.props.children).includes(label)));
const form = (tree: any) => find(tree, n => n.type === 'form');
const change = (node: any, value: string) => node.props.onChange({ target: { value } });
const event = { preventDefault: () => {} };
const open = { isOpen: true, onClose: () => {}, defaultTab: 'email' };

const groups = await harness('GroupsTab');
groups.environment.context.courses = [INITIAL_SAMPLE_COURSES[1], INITIAL_SAMPLE_COURSES[0]];
let tree = groups.render();
await button(tree, 'Delete task').props.onClick();
assert.equal(groups.deletes.length, 0, 'Cancel never invokes delete');
groups.confirm(); await button(tree, 'Delete task').props.onClick();
assert.equal(groups.deletes.length, 1);
const code = find(tree, n => n.type === 'strong');
code.props.ref.current = { focus: () => {} };
await button(tree, 'Copy invite code').props.onClick();
assert.ok(button(groups.render(), 'Invite code copied'));
groups.clipboardFail(); await button(groups.render(), 'Invite code copied').props.onClick();
assert.ok(button(groups.render(), 'Copy invite code'));
groups.clipboardMissing(); await button(groups.render(), 'Copy invite code').props.onClick();
assert.deepEqual(groups.clipboardCounts(), { copied: 1, selected: 2 });
button(tree, 'New group').props.onClick(); tree = groups.render();
assert.equal(input(tree, 'new-group-course').props.value, INITIAL_SAMPLE_COURSES[1].course_code);
assert.equal(input(tree, 'new-group-name').props.maxLength, 200);
assert.equal(input(tree, 'new-group-course').props.maxLength, 50);
assert.equal(input(tree, 'new-group-desc').props.maxLength, 2000);
change(input(tree, 'new-group-name'), 'x'.repeat(201)); await form(groups.render()).props.onSubmit(event);
assert.equal(groups.counts(), 0);
change(input(tree, 'new-group-name'), ' Project '); change(input(tree, 'new-group-desc'), 'x'.repeat(2001));
await form(groups.render()).props.onSubmit(event); assert.equal(groups.counts(), 0);
change(input(tree, 'new-group-desc'), ' Description ');
let releaseCreate!: (value: any) => void;
groups.create(new Promise(resolve => { releaseCreate = resolve; }));
const submit = form(groups.render()).props.onSubmit;
const pending = submit(event); await submit(event);
assert.equal(groups.counts(), 1); assert.equal(input(groups.render(), 'submit-create-group-btn').props.disabled, true);
releaseCreate(DEMO_GROUPS[0]); await pending;
button(groups.render(), 'New group').props.onClick();
change(input(groups.render(), 'new-group-name'), 'Project');
groups.create(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
await form(groups.render()).props.onSubmit(event);
assert.match(input(groups.render(), 'create-group-error-msg').props.children[1].props.children, /Check that you are signed in/);
button(groups.render(), 'Cancel').props.onClick();
button(groups.render(), 'Add group task').props.onClick(); tree = groups.render();
assert.equal(input(tree, 'task-assignee').props.value, '');
assert.equal(input(tree, 'task-title').props.maxLength, 300);
assert.equal(input(tree, 'task-desc').props.maxLength, 5000);
change(input(tree, 'task-title'), 'Shared task'); change(input(tree, 'task-status'), 'Working');
let releaseSave!: () => void; groups.pendingSave(new Promise<void>(resolve => { releaseSave = resolve; }));
const save = form(groups.render()).props.onSubmit;
const saving = save(event); await save(event);
assert.equal(groups.saves.length, 1); assert.equal(button(groups.render(), 'Saving...').props.disabled, true);
assert.equal(groups.saves[0].status, 'In Progress', 'Signed-in save matches rules');
assert.equal('assigned_to' in groups.saves[0], false);
releaseSave(); await saving;

const demo = await harness('SmartImportModal', true);
tree = demo.render(open); tree = demo.render(open);
assert.equal(button(tree, 'Extract Coursework').props.disabled, true);
assert.equal(button(tree, 'Sample Assignment'), undefined);
assert.match(JSON.stringify(tree), /Demo mode can't extract from course text, files, or screenshots/);
await button(tree, 'Extract Coursework').props.onClick(); assert.equal(demo.requests.length, 0);

const smart = await harness('SmartImportModal');
smart.environment.context.tasks = [DEMO_TASKS[0]] as any;
const imported = { ...DEMO_TASKS[0], task_id: 'new-import', title: 'New assignment', canvas_url: 'https://canvas.ubc.ca.evil.test/login', course: 'TEST 100', due_at: '2026-10-14' };
const lecture = { ...imported, task_id: 'lecture', type: 'lecture', title: 'Lecture 1' };
smart.response({ tasks: [imported, DEMO_TASKS[0], lecture], courses: [{ ...INITIAL_SAMPLE_COURSES[0], id: 'old-id', course_code: 'TEST 100' }] });
tree = smart.render(open); tree = smart.render(open);
change(input(tree, 'email-notification-textarea'), 'Assignment email');
await button(smart.render(open), 'Extract Coursework').props.onClick(); tree = smart.render(open);
assert.ok(find(tree, n => n.props?.role === 'note' && JSON.stringify(n.props.children).includes('canvas.ubc.ca.evil.test')), 'Smart Import review warns about the actual external destination');
const rowKey = find(tree, n => String(n.key).endsWith('course-TEST%20100')).key;
change(input(tree, 'extracted-course-code-course-TEST%20100'), 'TEST 200'); tree = smart.render(open);
assert.equal(find(tree, n => n.key === rowKey).key, rowKey, 'Code edits preserve row/focus identity');
await button(tree, 'Tasks &').props.onClick();
assert.equal(smart.imports[0][1].length, 1, 'Duplicates and lectures remain unselected');
assert.equal(smart.imports[0][1][0].course, 'TEST 200');
assert.equal(smart.imports[0][2][0].id, 'course-TEST%20200');
for (const record of [...smart.imports[0][1], ...smart.imports[0][2]]) {
  for (const flag of ['isDuplicate', 'isLecture', 'isUpdate']) assert.equal(flag in record, false);
}

// A failed import after session expiry remains open and emits a tagged production report.
const rejected = await harness('SmartImportModal');
rejected.response({ tasks: [imported], courses: [] });
let rejectedTree = rejected.render(open); rejectedTree = rejected.render(open);
change(input(rejectedTree, 'email-notification-textarea'), 'Assignment email');
await button(rejected.render(open), 'Extract Coursework').props.onClick();
rejected.environment.auth.currentUser = null as any;
await button(rejected.render(open), 'Tasks &').props.onClick();
assert.equal(rejected.environment.reports.at(-1).source, 'SmartImportModal.save');
assert.match(JSON.stringify(rejected.render(open)), /Import didn't finish/);

// The timed extraction path produces a signal rather than being filtered as benign cancellation.
const timedImport = await harness('SmartImportModal');
timedImport.render(open); change(input(timedImport.render(open), 'email-notification-textarea'), 'Assignment email');
timedImport.response(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
await button(timedImport.render(open), 'Extract Coursework').props.onClick();
assert.equal(timedImport.environment.reports.at(-1).source, 'SmartImportModal.extract');
assert.match(timedImport.environment.reports.at(-1).error.message, /timed out/);

// Batch 25: an existing preview confirmed in demo mode imports both kinds locally.
for (const includeTask of [true, false]) {
  const local = await harness('SmartImportModal');
  local.response({ tasks: includeTask ? [imported] : [], courses: [{ ...INITIAL_SAMPLE_COURSES[0], id: 'demo-local', course_code: 'TEST 100' }] });
  local.render(open);
  change(input(local.render(open), 'email-notification-textarea'), 'Course preview');
  await button(local.render(open), 'Extract Coursework').props.onClick();
  local.environment.context.isDemoMode = true;
  local.environment.auth.currentUser = null as any;
  let added = 0;
  local.environment.context.addTask = async () => { added++; };
  await button(local.render(open), 'Tasks &').props.onClick();
  assert.equal(local.imports.length, 0, 'Demo confirmation never invokes the cloud batch');
  assert.equal(added, includeTask ? 1 : 0);
  assert.equal(local.courseUpdates.length, 1, 'Selected courses reach the shared context');
  assert.equal(local.courseUpdates[0].course_code, 'TEST 100');
  assert.match(JSON.stringify(local.render(open)), new RegExp(`imported ${includeTask ? 1 : 0} tasks? and 1 course into demo workspace`));
}

const retiredCalendar = await harness('SmartImportModal');
tree = retiredCalendar.render({ ...open, defaultTab: 'calendar' });
tree = retiredCalendar.render({ ...open, defaultTab: 'calendar' });
assert.equal(input(tree, 'calendar-feed-url-input'), undefined);
assert.ok(find(tree, n => n.type === 'input' && n.props.type === 'file'));
assert.equal(retiredCalendar.requests.length, 0, 'Legacy calendar entry only offers document upload');

const unavailable = await harness('SmartImportModal');
unavailable.response({ error: 'Internal billing detail' }, 503);
tree = unavailable.render(open);
change(input(tree, 'email-notification-textarea'), 'Grade 5 Mathematics course outline');
await button(unavailable.render(open), 'Extract Coursework').props.onClick();
assert.match(JSON.stringify(unavailable.render(open)), /currently unavailable.*add courses and tasks manually/);
assert.doesNotMatch(JSON.stringify(unavailable.render(open)), /Internal billing detail/);

const image = await harness('SmartImportModal');
image.response({ tasks: [imported], courses: [] });
tree = image.render({ ...open, defaultTab: 'screenshot' }); tree = image.render({ ...open, defaultTab: 'screenshot' });
const upload = find(tree, n => n.type === 'input' && n.props.type === 'file');
upload.props.onChange({ target: { files: [{ name: 'shot.gif', type: 'image/gif', size: 100 }] } });
await new Promise(resolve => setImmediate(resolve));
await button(image.render({ ...open, defaultTab: 'screenshot' }), 'Extract Coursework').props.onClick();
assert.equal(image.requests[0].body.mimeType, 'image/jpeg');
assert.equal(image.requests[0].body.imageBase64, 'data:image/jpeg;base64,encoded');

for (const method of ['screen', 'camera']) {
  const capture = await harness('SmartImportModal');
  const props = { ...open, defaultTab: 'screenshot' };
  tree = capture.render(props); tree = capture.render(props);
  const chosenFile = { name: 'previous.gif', type: 'image/gif', size: 100 };
  find(tree, n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [chosenFile] } });
  await new Promise(resolve => setImmediate(resolve));
  button(capture.render(props), method === 'screen' ? 'Window / Tab Capture' : 'Use Camera').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = capture.render(props);
  button(tree, method === 'screen' ? 'Retake Screen Capture' : 'Retake Camera Photo').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = capture.render(props);
  if (method === 'screen') {
    change(input(tree, 'capture-timer-select'), '0');
    await button(capture.render(props), 'Select Tab & Capture').props.onClick();
  } else {
    find(tree, n => n.type === 'video').props.ref.current = { videoWidth: 800, videoHeight: 600 };
    button(tree, 'Snap Photo').props.onClick();
  }
  assert.equal(capture.stateValues().includes(chosenFile), false, `${method} capture clears the old File`);
}

const syllabus = await harness('SyllabusImportModal');
syllabus.environment.context.tasks = [DEMO_TASKS[0]] as any;
syllabus.response({ courses: [INITIAL_SAMPLE_COURSES[0]], tasks: [DEMO_TASKS[0], imported] });
tree = syllabus.render(open);
button(tree, 'Paste Syllabus Text').props.onClick(); tree = syllabus.render(open);
change(input(tree, 'syllabus-paste-area'), 'Syllabus');
await button(syllabus.render(open), 'Read this').props.onClick(); tree = syllabus.render(open);
assert.ok(find(tree, n => n.props?.role === 'note' && JSON.stringify(n.props.children).includes('canvas.ubc.ca.evil.test')), 'Syllabus review warns about the external destination');
await button(tree, 'Confirm & Import to Dashboard').props.onClick();
assert.equal(syllabus.imports[0][1].length, 1);
assert.equal('isDuplicate' in syllabus.imports[0][1][0], false);

const rules = readFileSync('firestore.rules', 'utf8');
const groupCreateRule = rules.slice(rules.indexOf('match /groups/{groupId}'), rules.indexOf('// Group update rule:'));
assert.match(groupCreateRule, /description is string && request.resource.data.description.size\(\) <= 2000/);
assert.match(groupCreateRule, /request.resource.data.created_by == request.auth.uid/);
assert.match(groupCreateRule, /request.resource.data.members == \[request.auth.uid\]/);
console.log('Batch 16 form, clipboard, import payload, course correction, ICS, MIME and rule regressions passed.');

// Batch 17: a demo syllabus import must save weights and edited credits in shared memory.
const demoSyllabus = await harness('SyllabusImportModal', true);
demoSyllabus.response({ courses: [INITIAL_SAMPLE_COURSES[0]], tasks: [] });
tree = demoSyllabus.render(open);
button(tree, 'Paste Syllabus Text').props.onClick(); tree = demoSyllabus.render(open);
change(input(tree, 'syllabus-paste-area'), 'Syllabus');
await button(demoSyllabus.render(open), 'Read this').props.onClick(); tree = demoSyllabus.render(open);
change(input(tree, 'rev-course-credits'), '6'); tree = demoSyllabus.render(open);
await button(tree, 'Confirm & Import to Dashboard').props.onClick();
assert.equal(demoSyllabus.courseUpdates.length, 1);
assert.equal(demoSyllabus.courseUpdates[0].credits, 6);
assert.deepEqual(demoSyllabus.courseUpdates[0].grade_categories.map((c: any) => [c.name, c.weight, c.dropLowest]),
  INITIAL_SAMPLE_COURSES[0].grade_categories!.map(c => [c.name, c.weight, c.dropLowest]));
assert.equal(demoSyllabus.imports.length, 0, 'Demo syllabus import does not write to Firestore');
console.log('Batch 17 demo syllabus weights and credits persistence passed.');
