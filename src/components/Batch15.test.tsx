import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import TaskFields, { validateTaskIdentity, taskSaveError } from './TaskFields';
import { DEMO_CLASSES, DEMO_GROUPS, DEMO_TASKS } from '../demoData';
import { INITIAL_SAMPLE_COURSES } from '../services/db';
import { getTaskEstimatedHours } from '../services/workloadService';

assert.equal(validateTaskIdentity('   ','  ').title,'Task title cannot be empty.');
assert.equal(validateTaskIdentity('   ','  ').course,'Course code cannot be empty.');
assert.ok(validateTaskIdentity('x'.repeat(301),'General').title);
assert.match(taskSaveError({code:'permission-denied'}),/Check that you are signed in/);
for (const prefix of ['task','edit-task'] as const) {
  const html = renderToStaticMarkup(<TaskFields prefix={prefix} title=" " course=" " type="quiz" dueAt="2026-10-05T23:59"
    status="Working" summary="" identityErrors={validateTaskIdentity(' ',' ')}
    onTitleChange={()=>{}} onCourseChange={()=>{}} onTypeChange={()=>{}} onDueChange={()=>{}} onStatusChange={()=>{}} onNotesChange={()=>{}} />);
  assert.match(html,/type="datetime-local"/);
  assert.match(html,/America\/Vancouver/);
  assert.match(html,/maxLength="300"/);
  assert.match(html,/aria-invalid="true"/);
  assert.match(html,/aria-describedby=".*-title-error"/);
  assert.match(html,/role="alert"/);
}
const english = INITIAL_SAMPLE_COURSES.find(c=>c.course_code==='ENGL 112')!;
assert.equal(english.meeting_times,'Tue / Thu 12:00 PM - 1:30 PM');
assert.ok(DEMO_CLASSES.filter(c=>c.course_code==='ENGL 112').every(c=>c.start_time==='12:00' && c.end_time==='13:30'));
assert.ok(INITIAL_SAMPLE_COURSES.every(c=>c.instructor.includes('Example') && c.instructor_email===''));
assert.ok(DEMO_CLASSES.every(c=>c.instructor?.includes('Example') || c.instructor==='TA Team'));
assert.ok(DEMO_GROUPS.every(g=>Object.values(g.member_details || {}).every(m=>!m.email || m.email.endsWith('@example.invalid'))));

// Drive the actual modal event handlers with a controlled hook runtime and transport.
// This exercises save payloads and prop changes without connecting to Firebase.
async function modalHarness(name: string, isDemoMode = true) {
  const values: any[] = [], deps: any[][] = [];
  let index = 0, authCalls = 0, fetchCalls = 0;
  const saved: any[] = [];
  let failSave = false;
  let response = {ok:true,json:async()=>({estimatedHours:4,source:'heuristic'})};
  const hooks = {
    ...React,
    useState: (initial: any) => {
      const slot=index++;
      if (!(slot in values)) values[slot]=typeof initial==='function'?initial():initial;
      return [values[slot],(next: any)=>{values[slot]=typeof next==='function'?next(values[slot]):next;}];
    },
    useEffect: (effect: any, next: any[]) => {
      const slot=index++;
      if (!deps[slot] || next.some((v,i)=>v!==deps[slot][i])) { deps[slot]=next; effect(); }
    },
    useMemo: (fn: any)=>fn(), useRef: ()=>({current:null})
  };
  const context = {isDemoMode,tasks:[],courses:[],notificationPrefs:{},showToast:()=>{},
    updateTask:async (_id: string, updates: any)=>{if(failSave) throw {code:'permission-denied'}; saved.push(updates);},
    addTask:async (task: any)=>{saved.push(task);},deleteTask:async()=>{}};
  const bundle = await build({entryPoints:[`src/components/${name}.tsx`],bundle:true,write:false,platform:'node',format:'cjs',
    external:['react/jsx-runtime','firebase/*','lucide-react'], logLevel:'silent', plugins:[{name:'batch15-modal',setup(b) {
      b.onResolve({filter:/^(react|.*\/hooks\/useTasks|.*\/hooks\/useViewMode|.*\/hooks\/useModalFocus|.*\/auth|.*\/TaskBreakdownModal)$/},args=>({path:args.path,namespace:'batch15'}));
      b.onLoad({filter:/.*/,namespace:'batch15'},args=>({contents:
        args.path==='react' ? 'export default globalThis.hooks; export const {useState,useEffect,useMemo,useRef}=globalThis.hooks;' :
        args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;' :
        args.path.endsWith('/useViewMode') ? 'export const useViewMode=()=>({isSimple:false});' :
        args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});' :
        args.path.endsWith('/auth') ? 'export const getAuthHeader=globalThis.authHeader;' : 'export default ()=>null;'}));
    }}]});
  const module = {exports:{} as any};
  new Function('module','exports','require','globalThis','fetch','navigator',bundle.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url),
    {hooks,context,authHeader:async()=>{authCalls++;return {Authorization:'Bearer test'};}},async()=>{fetchCalls++;return response;},{onLine:true});
  return {saved,render:(props: any)=>{index=0;return module.exports.default(props);},
    counts:()=>({authCalls,fetchCalls}),fail:()=>{failSave=true;},failEstimate:()=>{response={ok:false,json:async()=>({error:'Estimator unavailable'})} as any;}};
}
function find(tree: any, predicate: (node: any)=>boolean): any {
  if (!tree || typeof tree!=='object') return;
  if (predicate(tree)) return tree;
  const children = Array.isArray(tree)?tree:React.Children.toArray(tree.props?.children);
  for (const child of children) { const result=find(child,predicate); if(result) return result; }
}
const fields = (tree: any)=>find(tree,n=>n.props?.prefix==='edit-task');
const form = (tree: any)=>find(tree,n=>n.type==='form');
const input = (tree: any,id: string)=>find(tree,n=>n.props?.id===id);
const button = (tree: any,text: string)=>find(tree,n=>n.type==='button' && JSON.stringify(n.props.children).includes(text));
const event = {preventDefault:()=>{}};
const base = {...DEMO_TASKS[2],estimated_hours:undefined,status:'Not Started'};
const h = await modalHarness('EditTaskModal');
let props = {task:base,isOpen:true,onClose:()=>{}};
let tree=h.render(props);
fields(tree).props.onNotesChange('Unrelated edit');
await form(h.render(props)).props.onSubmit(event);
assert.equal('estimated_hours' in h.saved[0],false,'Unedited heuristic remains inferred');
assert.equal('status' in h.saved[0],false,'Unedited status is omitted');
props={...props,task:{...base,status:'Working'}};
h.render(props);tree=h.render(props);
assert.equal(fields(tree).props.status,'Working','Nested plan promotion re-syncs status');
await form(tree).props.onSubmit(event);
assert.equal('status' in h.saved[1],false,'Saving does not revert nested plan status');
fields(tree).props.onStatusChange('Submitted');
await form(h.render(props)).props.onSubmit(event);
assert.equal(h.saved[2].status,'Submitted');
input(tree,'edit-task-effort').props.onChange({target:{value:'0.5'}});
await form(h.render(props)).props.onSubmit(event);
assert.equal(h.saved[3].estimated_hours,0.5);
input(tree,'edit-task-effort').props.onChange({target:{value:''}});
assert.equal(input(h.render(props),'edit-task-effort').props.value,'');
await button(h.render(props),'Suggest hours').props.onClick();
assert.deepEqual(h.counts(),{authCalls:0,fetchCalls:0},'Demo estimator makes no auth or network calls');
assert.equal(input(h.render(props),'edit-task-effort').props.value,'4');
const signed = await modalHarness('EditTaskModal',false);
await button(signed.render(props),'Suggest hours').props.onClick();
assert.deepEqual(signed.counts(),{authCalls:1,fetchCalls:1});
signed.failEstimate();
await button(signed.render(props),'Suggest hours').props.onClick();
assert.equal(input(signed.render(props),'edit-task-effort').props.value,'4','Failed request leaves hours unchanged');
assert.match(JSON.stringify(signed.render(props)),/Estimate unavailable/);
signed.fail();
await form(signed.render(props)).props.onSubmit(event);
assert.match(JSON.stringify(signed.render(props)),/Check that you are signed in/);

const add = await modalHarness('AddTaskModal');
const addProps = {isOpen:true,onClose:()=>{}};
add.render(addProps);
let addTree=add.render(addProps);
const addFields = (tree: any)=>find(tree,n=>n.props?.prefix==='task');
addFields(addTree).props.onTitleChange('   ');
addFields(addTree).props.onCourseChange('   ');
await form(add.render(addProps)).props.onSubmit(event);
assert.equal(add.saved.length,0);
assert.ok(addFields(add.render(addProps)).props.identityErrors.title);
addFields(addTree).props.onTitleChange('Manual quiz');
addFields(addTree).props.onCourseChange('MATH 200');
addFields(add.render(addProps)).props.onDueChange('2026-02-30T12:00');
await form(add.render(addProps)).props.onSubmit(event);
assert.equal(add.saved.length, 0, 'Impossible manual date cannot save or roll into March');
assert.match(addFields(add.render(addProps)).props.dueDateError, /valid due date/);
addFields(add.render(addProps)).props.onDueChange('2026-10-14T12:00');
await form(add.render(addProps)).props.onSubmit(event);
assert.equal(addFields(add.render(addProps)).props.dueDateError, null, 'Correcting the date clears its ARIA error');
assert.equal(add.saved[0].canvas_url,'','Manual tasks have no fabricated submission link');

const sixSteps = {...base,subtasks:Array.from({length:6},(_,i)=>({id:String(i),title:'Step',done:false,duration:'2 hours'}))};
assert.equal(getTaskEstimatedHours(sixSteps),getTaskEstimatedHours({title:sixSteps.title,type:sixSteps.type}), 'Fallback follows the existing task estimate policy even with planned durations');
console.log('Batch 15 form, estimator, payload, validation and fixture regressions passed.');
