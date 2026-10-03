import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import * as FirebaseFirestore from 'firebase/firestore';
import { initializeFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, terminate } from 'firebase/firestore';
import { generateLocalDraft, matchCourse } from '../components/QuickAddModal';
import { generateLocalDraft as activeDraft } from '../components/AddTaskModal';
import { parseNaturalLanguageTaskFallback } from '../../server/lib';
import { normalizeTask, normalizeClassScheduleItem, normalizeExamItem, normalizeGroupProject } from './db';

const refDate = new Date('2026-10-02T19:00:00Z');
for (const text of ['orgo lab report due Friday', 'physics lab due Friday', 'math homework', 'english reading']) {
  assert.equal(matchCourse(text, [], true), 'General');
  assert.equal(activeDraft(text).course, 'General');
  assert.equal(parseNaturalLanguageTaskFallback(text, refDate).course, 'General');
}
assert.equal(matchCourse('orgo lab report due Friday', [{ course_code: 'CHEM 213' }]), 'CHEM 213');
assert.equal(matchCourse('physics lab', [{ course_code: 'CPSC 310' }]), 'General');
const draft = generateLocalDraft('Lab report due next Friday worth 40%', [], false, refDate);
assert.equal(draft.weight, 40);
assert.equal(draft.points_possible, undefined);
assert.equal(draft.summary, '');
assert.equal(draft.canvas_url, '');
assert.equal(normalizeTask({ ...draft, weight: 40 }, 'weight-test').weight, 40);
assert.equal(normalizeTask({ weight: 40 }, 'weight-test').points_possible, '');
assert.equal(parseNaturalLanguageTaskFallback('Lab report worth 40%', refDate).points_possible, '');
assert.equal(normalizeGroupProject({}, 'legacy').invite_code, '');
assert.equal(normalizeGroupProject({}, 'legacy').invite_code, '');
const classItem = normalizeClassScheduleItem({ course_code: 'C'.repeat(200), location: {}, start_time: 42 }, 'class');
assert.equal(classItem.course_code.length, 100);
assert.equal(classItem.location, '');
assert.equal(classItem.start_time, '');
const examItem = normalizeExamItem({ course_code: {}, notes: [], title: 12, weight_percent: Infinity }, 'exam');
assert.equal(examItem.course_code, 'General');
assert.equal(examItem.title, 'Exam');
assert.equal(examItem.notes, '');
assert.equal(examItem.weight_percent, undefined);

// Execute the actual database service with a controlled storage transport.
const stored = new Map<string, any>();
const writes: { path: string; merge: boolean }[] = [];
const rejected = new Set<string>();
const copy = (value: any) => JSON.parse(JSON.stringify(value));
const snap = (path: string) => ({ id: path.split('/').at(-1), ref: path, exists: () => stored.has(path), data: () => copy(stored.get(path)) });
let revision = 0;
let conflicts = 0;
const firestore = {
  doc: (_db: any, ...parts: string[]) => parts.join('/'),
  collection: (_db: any, ...parts: string[]) => parts.join('/'),
  getDoc: async (path: string) => snap(path),
  getDocs: async (path: string) => {
    const docs = [...stored.keys()].filter(key => key.startsWith(path + '/') && key.slice(path.length + 1).indexOf('/') === -1).map(snap);
    return { docs, forEach: (fn: any) => docs.forEach(fn) };
  },
  setDoc: async (path: string, value: any, options?: {merge?: boolean}) => {
    if (rejected.has(path)) throw new Error('permission-denied');
    stored.set(path, options?.merge ? { ...stored.get(path), ...copy(value) } : copy(value));
    writes.push({path, merge: options?.merge === true}); revision++;
  },
  updateDoc: async (path: string, value: any) => {
    if (!stored.has(path)) throw new Error('not-found');
    stored.set(path, {...stored.get(path), ...copy(value)}); revision++;
  },
  deleteDoc: async (path: string) => { stored.delete(path); revision++; },
  deleteField: () => ({_delete: true}),
  serverTimestamp: () => ({_timestamp: true}),
  runTransaction: async (_db: any, action: any) => {
    for (;;) {
      const version = revision;
      let pending: [string, any] | undefined;
      const result = await action({get: async (path: string) => snap(path), update: (path: string, value: any) => {pending = [path, value];}});
      if (version !== revision) { conflicts++; continue; }
      if (pending) { stored.set(pending[0], {...stored.get(pending[0]), ...copy(pending[1])}); revision++; }
      return result;
    }
  }
};
async function service(db: any, mock?: any) {
  const bundle = await build({entryPoints:['src/services/db.ts'], bundle:true, write:false, platform:'node', format:'cjs', logLevel:'silent',
    external: mock ? [] : ['firebase/*'], plugins:[{name:'batch14-transport', setup(builder) {
      builder.onResolve({filter:/^\.\.\/auth$/}, () => ({path:'auth',namespace:'batch14'}));
      if (mock) builder.onResolve({filter:/^firebase\/(firestore|auth)$/}, args => ({path:args.path,namespace:'batch14'}));
      builder.onLoad({filter:/.*/,namespace:'batch14'}, args => ({contents:args.path === 'auth' ? 'export const db = globalThis.testDb;' : args.path.endsWith('/auth') ? '' :
        ['collection','doc','getDoc','getDocs','setDoc','updateDoc','deleteDoc','deleteField','onSnapshot','serverTimestamp','writeBatch','runTransaction','query','where','limit'].map(name => `export const ${name} = (...args) => globalThis.testTransport.${name}(...args);`).join('\n')}));
    }}]});
  const module = {exports:{} as any};
  new Function('module', 'exports', 'require', 'globalThis', bundle.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), {testDb:db,testTransport:mock});
  return module.exports;
}
const api = await service({}, firestore);
const path = 'users/alice/tasks/focus';
stored.set(path, {title:'Focus',logged_minutes:0,focus_sessions:[]});
const session = (id: string, minutes: number) => ({id,duration_minutes:minutes,mode:'custom',completed_at:refDate.toISOString()});
await Promise.all([api.logFirestoreFocusSession('alice','focus',session('a',20)),api.logFirestoreFocusSession('alice','focus',session('b',25))]);
assert.ok(conflicts > 0, 'Concurrent writes exercise transaction retry');
assert.equal(stored.get(path).logged_minutes,45);
await Promise.all([api.logFirestoreFocusSession('alice','focus',session('a',20)),api.logFirestoreFocusSession('alice','focus',session('a',20))]);
assert.equal(stored.get(path).logged_minutes,45);
assert.equal(stored.get(path).focus_sessions.length,2);
await assert.rejects(api.logFirestoreFocusSession('alice','missing',session('c',5)), /Task no longer exists/);
assert.equal(stored.has('users/alice/tasks/missing'),false);
const taskId = await api.saveFirestoreGroupTask('group', {title:'Created',created_by:'forged'}, 'alice', 'Alice');
const groupTaskPath = `groups/group/tasks/${taskId}`;
assert.equal(stored.get(groupTaskPath).created_by,'alice');
assert.equal(stored.get(groupTaskPath).created_by_name,'Alice');
await api.saveFirestoreGroupTask('group', {id:taskId,title:'Updated',created_by:'bob'}, 'bob', 'Bob');
assert.equal(stored.get(groupTaskPath).created_by,'alice');
assert.equal(stored.get(groupTaskPath).last_modified_by,'bob');
const group = await api.createFirestoreGroupProject('alice',{displayName:'Alice',email:'private@example.com',photoURL:'https://private.example/photo'},{name:'Group',course_code:'CHEM 213'});
assert.deepEqual(Object.keys(stored.get(`groups/${group.id}`).member_details.alice).sort(), ['displayName','role','uid']);

stored.set('users/alice', { email:'alice@example.invalid', displayName:'Alice', notificationPrefs: {
  savedCalendarFeedUrl:'https://canvas.ubc.ca/feeds/private-secret.ics', customEmail:'private@example.invalid',
  enabled:true, quietHours:{enabled:true,start:'22:00',end:'08:00'}
}});
const exported = await api.createFullDashboardBackup('alice');
assert.equal(exported.notificationPrefs.savedCalendarFeedUrl,undefined);
assert.equal(exported.notificationPrefs.customEmail,undefined);
assert.equal(exported.notificationPrefs.quietHours.start,'22:00');
assert.equal(stored.get('users/alice').notificationPrefs.customEmail,'private@example.invalid', 'Export does not mutate saved settings');

stored.clear(); writes.length = 0;
for (const [kind,id,value] of [['tasks','same',{task_id:'same',title:'Old',category_id:'stale',subtasks:[{id:'old',title:'Old',done:false}]}],['courses','same',{id:'same',course_code:'CHEM 213',grade_categories:[{id:'old',name:'Old',weight:40}]}],['classes','same',{id:'same',course_code:'CHEM 213',section:'stale'}],['exams','same',{id:'same',course_code:'CHEM 213',seat:'stale'}]] as const) stored.set(`users/alice/${kind}/${id}`,value);
stored.set('users/alice/tasks/absent',{task_id:'absent',title:'Absent'});
const backup = {tasks:[{task_id:'same',title:'New'}],courses:[{id:'same',course_code:'CHEM 213'}],classes:[{id:'same',course_code:'C'.repeat(150),start_time:'3:00 PM'}],exams:[{id:'same',course_code:42,title:'Exam'}]};
const result = await api.restoreDashboardBackup('alice',backup,'replace');
assert.equal(result.tasksRestored,1);
assert.equal(writes.every(write => !write.merge),true);
assert.equal(stored.get('users/alice/tasks/same').category_id,undefined);
assert.equal(stored.get('users/alice/tasks/same').subtasks,undefined);
assert.equal(stored.get('users/alice/courses/same').grade_categories,undefined);
assert.equal(stored.get('users/alice/classes/same').section,undefined);
assert.equal(stored.get('users/alice/exams/same').seat,undefined);
assert.equal(stored.get('users/alice/classes/same').course_code.length,100);
assert.equal(stored.get('users/alice/classes/same').start_time,'15:00');
assert.equal(stored.get('users/alice/exams/same').course_code,'General');
assert.equal(stored.has('users/alice/tasks/absent'),false);
rejected.add('users/alice/classes/denied');
stored.set('users/alice/tasks/keep-on-failure',{task_id:'keep-on-failure',title:'Keep'});
await assert.rejects(api.restoreDashboardBackup('alice',{...backup,classes:[{id:'bad/id'}, {id:'x'.repeat(129)}, {id:'denied'}, {id:'later',course_code:'CHEM 213'}], exams:[{id:'later-exam',course_code:'CHEM 213'}]},'replace'), error => {
  const failure = error as any;
  assert.equal(failure.classesRestored,1);
  assert.equal(failure.examsRestored,1);
  assert.match(failure.message,/permission-denied/);
  assert.match(failure.message,/contain no/);
  return true;
});
assert.equal(stored.has('users/alice/classes/later'),true);
assert.equal(stored.has('users/alice/exams/later-exam'),true);
assert.equal(stored.has('users/alice/tasks/keep-on-failure'),true);
console.log('Batch 14 course, weight, privacy, attribution, concurrency, missing-task and restore regression checks passed.');

// Optional integration run against a locally started emulator, never production.
if (process.env.BATCH14_FIRESTORE_EMULATOR) {
  const [host,port] = process.env.BATCH14_FIRESTORE_EMULATOR.split(':');
  assert.ok(['127.0.0.1','localhost'].includes(host));
  const clients = ['alice','bob','outsider'].map(uid => {
    const app = initializeApp({projectId:'demo-batch14',apiKey:'fake',appId:'fake'},`batch14-${uid}`);
    const db = initializeFirestore(app,{});
    connectFirestoreEmulator(db,host,Number(port),{mockUserToken:{sub:uid,user_id:uid,email:`${uid}@example.com`}});
    return {uid,app,db};
  });
  try {
    const [alice,bob,outsider] = clients;
    const real = await service(alice.db, FirebaseFirestore);
    const g = await real.createFirestoreGroupProject('alice',{displayName:'Alice',email:'private@example.com',photoURL:'https://private.example/photo'},{name:'Rules test',course_code:'CHEM 213'});
    const created = (await getDoc(doc(alice.db,'groups',g.id))).data()!;
    assert.deepEqual(Object.keys(created.member_details.alice).sort(),['displayName','role','uid']);
    const joined = await service(bob.db, FirebaseFirestore);
    await joined.joinFirestoreGroupByCode('bob',{displayName:'Bob',email:'private@example.com'},g.invite_code);
    const afterJoin = (await getDoc(doc(bob.db,'groups',g.id))).data()!;
    assert.deepEqual(Object.keys(afterJoin.member_details.bob).sort(),['displayName','role','uid']);
    const id = await real.saveFirestoreGroupTask(g.id,{title:'Attributed'},'alice','Alice');
    await joined.saveFirestoreGroupTask(g.id,{id,title:'Teammate edit'},'bob','Bob');
    const saved = (await getDoc(doc(bob.db,'groups',g.id,'tasks',id))).data()!;
    assert.equal(saved.created_by,'alice'); assert.equal(saved.created_by_name,'Alice'); assert.equal(saved.last_modified_by,'bob');
    await assert.rejects(setDoc(doc(bob.db,'groups',g.id,'tasks','forged'),{id:'forged',group_id:g.id,title:'Forgery',created_by:'alice'}), /permission/i);
    await assert.rejects(updateDoc(doc(bob.db,'groups',g.id,'tasks',id),{created_by:'bob',last_modified_by:'bob'}), /permission/i);
    await assert.rejects(updateDoc(doc(bob.db,'groups',g.id,'tasks',id),{last_modified_by:'alice'}), /permission/i);
    await assert.rejects(getDoc(doc(outsider.db,'groups',g.id,'tasks',id)), /permission/i);
    const {invite_code: _invite,...noInvite} = created;
    await assert.rejects(setDoc(doc(alice.db,'groups','no-invite'),{...noInvite,id:'no-invite'}), /permission/i);
    await assert.rejects(setDoc(doc(alice.db,'groups','invalid-invite'),{...created,id:'invalid-invite',invite_code:'UBC1234'}), /permission/i);
    const boundsRef = doc(alice.db,'users','alice','tasks','focus-bounds');
    await setDoc(boundsRef,{title:'Boundaries',logged_minutes:0,focus_sessions:[]});
    await updateDoc(boundsRef,{logged_minutes:100000});
    for (const invalid of [-1,100001,'5']) {
      await assert.rejects(updateDoc(boundsRef,{logged_minutes:invalid}), /permission/i);
    }
    await assert.rejects(updateDoc(boundsRef,{focus_sessions:'not-a-list'}), /permission/i);
    await assert.rejects(updateDoc(boundsRef,{focus_sessions:Array.from({length:501},(_,i)=>({id:String(i)}))}), /permission/i);
    await assert.rejects(updateDoc(doc(outsider.db,'users','alice','tasks','focus-bounds'),{logged_minutes:5}), /permission/i);

    await setDoc(doc(alice.db,'users','alice','tasks','focus'),{title:'Focus',logged_minutes:0,focus_sessions:[]});
    await Promise.all([real.logFirestoreFocusSession('alice','focus',session('a',20)),real.logFirestoreFocusSession('alice','focus',session('b',25))]);
    await Promise.all([real.logFirestoreFocusSession('alice','focus',session('a',20)),real.logFirestoreFocusSession('alice','focus',session('a',20))]);
    const focus = (await getDoc(doc(alice.db,'users','alice','tasks','focus'))).data()!;
    assert.equal(focus.logged_minutes,45); assert.equal(focus.focus_sessions.length,2);
    await assert.rejects(real.logFirestoreFocusSession('alice','missing',session('c',5)), /Task no longer exists/);
    await setDoc(doc(alice.db,'users','alice','tasks','same'),{task_id:'same',title:'Old',category_id:'stale',subtasks:[{id:'old',title:'Old',done:false}]});
    await setDoc(doc(alice.db,'users','alice','courses','same'),{id:'same',course_code:'CHEM 213',grade_categories:[{id:'old',name:'Old',weight:40}]});
    await setDoc(doc(alice.db,'users','alice','classes','same'),{id:'same',course_code:'CHEM 213',section:'stale'});
    await setDoc(doc(alice.db,'users','alice','exams','same'),{id:'same',course_code:'CHEM 213',seat:'stale'});
    const replaced = await real.restoreDashboardBackup('alice',backup,'replace');
    assert.equal(replaced.classesRestored,1); assert.equal(replaced.examsRestored,1);
    for (const [kind,field] of [['tasks','category_id'],['tasks','subtasks'],['courses','grade_categories'],['classes','section'],['exams','seat']]) {
      assert.equal((await getDoc(doc(alice.db,'users','alice',kind,'same'))).data()![field],undefined);
    }
    await assert.rejects(real.restoreDashboardBackup('alice',{...backup,tasks:[{task_id:'denied-task',title:'Too many subtasks',subtasks:Array.from({length:51},(_,i) => ({id:String(i),title:'Step',done:false}))}],classes:[{id:'bad/id'}, {id:'valid-later',course_code:'CHEM 213'}],exams:[{id:'valid-later',course_code:'CHEM 213'}]},'replace'), error => {
      const failure = error as any;
      assert.equal(failure.classesRestored,1); assert.equal(failure.examsRestored,1);
      return true;
    });
    assert.equal((await getDoc(doc(alice.db,'users','alice','tasks','same'))).exists(),true, 'Partial restore never deletes existing documents');
    assert.equal((await getDoc(doc(alice.db,'users','alice','classes','valid-later'))).exists(),true);
    await assert.rejects(setDoc(doc(alice.db,'users','alice','exams','bad-notes'),{course_code:'CHEM 213',notes:'x'.repeat(5001)}), /permission/i);
    await assert.rejects(setDoc(doc(alice.db,'users','alice','classes','bad-location'),{course_code:'CHEM 213',location:{}}), /permission/i);
    await assert.rejects(setDoc(doc(alice.db,'users','alice','tasks','bad-weight'),{title:'Weight',weight:101}), /permission/i);
    console.log('Batch 14 Firestore emulator: rule enforcement, privacy, attribution, transactions and normalized restore passed.');
  } finally {
    for (const client of clients) { await terminate(client.db); await deleteApp(client.app); }
  }
}
