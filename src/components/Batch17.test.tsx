import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Course } from '../types';
import { DEMO_TASKS } from '../demoData';
import { INITIAL_SAMPLE_COURSES, normalizeCourse } from '../services/db';
import { coursesWithTaskShells, hasConfirmedWeights } from '../services/courseState';

async function harness(name: string) {
  const values: any[] = [], deps: any[][] = [];
  let index = 0, pendingEffects: (() => void)[] = [];
  const imports: string[] = [], writes: Course[] = [], reports: string[] = [];
  const context: any = { tasks: [], courses: [], isDemoMode: true, loading: false, error: null,
    updateCourse: async (course: Course) => {
      writes.push(course);
      const previous = context.courses.find((c: Course) => c.id === course.id);
      context.courses = previous ? context.courses.map((c: Course) => c.id === course.id ? course : c) : [...context.courses, course];
    }, openImport: (tab: string) => imports.push(tab), refreshTasks: () => {}, updateUiPrefs: () => {}, updateTask: async () => {} };
  const hooks = { ...React,
    useState: (initial: any) => {
      const slot = index++;
      if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
    },
    useRef: (initial: any) => { const slot = index++; return values[slot] ||= { current: initial }; },
    useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn,
    useEffect: (effect: any, next: any[] = []) => {
      const slot = index++;
      if (!deps[slot] || next.some((v, i) => v !== deps[slot][i])) { deps[slot] = next; pendingEffects.push(effect); }
    }
  };
  const clipboard: any = { writeText: async (text: string) => { reports.push(text); } };
  const env = { hooks, context, navigator: { clipboard } };
  const result = await build({ entryPoints: [`src/components/${name}.tsx`], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['react/jsx-runtime', 'lucide-react', 'firebase/*'],
    logLevel: 'silent', plugins: [{ name: 'batch17', setup(b) {
      b.onResolve({ filter: /^(react|.*\/hooks\/useTasks|.*\/hooks\/useViewMode|.*\/hooks\/useModalFocus|.*\/auth|.*\/CourseWeightingModal|.*\/EditTaskModal|.*\/FinalExamCalculatorCard|.*\/CourseGradeDetailCard)$/ }, args => args.kind === 'entry-point' ? undefined : ({ path: args.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents:
        args.path === 'react' ? 'export default globalThis.hooks; export const {useState,useRef,useMemo,useCallback,useEffect}=globalThis.hooks;' :
        args.path.endsWith('/useTasks') ? 'export const useTasksContext=()=>globalThis.context;' :
        args.path.endsWith('/useViewMode') ? 'export const useViewMode=()=>({isDetailed:true});' :
        args.path.endsWith('/useModalFocus') ? 'export const useModalFocus=()=>({modalRef:null,handleBackdropClick:()=>{}});' :
        args.path.endsWith('/auth') ? 'export const auth={}; export const db={};' :
        `export default '${args.path.split('/').pop()}';` }));
    } }] });
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', 'globalThis', 'navigator', 'document', 'setTimeout', result.outputFiles[0].text)(
    module, module.exports, createRequire(import.meta.url), env, env.navigator,
    { addEventListener: () => {}, removeEventListener: () => {} }, () => 0);
  return { context, writes, imports, reports, env,
    render: (props: any = {}) => { index = 0; const tree = module.exports.default(props); const effects = pendingEffects; pendingEffects = []; effects.forEach(fn => fn()); return tree; },
    failCopy: () => { clipboard.writeText = async () => { throw new Error('Denied'); }; },
    missingCopy: () => { env.navigator.clipboard = undefined; },
    pendingCopy: (promise: Promise<void>) => { clipboard.writeText = () => promise; }
  };
}
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  const children = Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children);
  for (const child of children) { const found = find(child, predicate); if (found) return found; }
}
const button = (tree: any, text: string) => find(tree, n => n.type === 'button' && JSON.stringify(n.props.children).includes(text));
const input = (tree: any, id: string) => find(tree, n => n.props?.id === id);
const change = (node: any, value: string) => node.props.onChange({ target: { value } });
const text = (tree: any): string => {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return (Array.isArray(tree) ? tree : React.Children.toArray(tree.props?.children)).map(text).join(' ');
};
const course = { ...INITIAL_SAMPLE_COURSES[0], credits: 5 };
const props = { courseResults: [{ course, result: { currentGrade: 90, currentGradedWeight: 20 } }] };
const gpa = await harness('UbcGpaConverter'); gpa.context.courses = [course];
let tree = gpa.render(props);
button(tree, '+ Add Prior Terms').props.onClick(); tree = gpa.render(props);
assert.equal(input(tree, 'prior-credits').props.value, ''); assert.equal(input(tree, 'prior-gpa').props.value, '');
assert.match(text(tree), /Enter prior credits and GPA/);
await button(tree, 'Export Report').props.onClick(); assert.doesNotMatch(gpa.reports[0], /Prior Credits:|Cumulative GPA:/);
change(input(tree, 'prior-credits'), '30'); tree = gpa.render(props);
assert.match(text(tree), /Enter prior credits and GPA/);
change(input(tree, 'prior-gpa'), '4.20'); tree = gpa.render(props);
button(tree, '4.0 Scale (OMSAS)').props.onClick(); tree = gpa.render(props);
assert.equal(input(tree, 'prior-gpa').props.value, '', 'Each scale has its own prior GPA');
assert.match(text(tree), /Enter prior credits and GPA/);
change(input(tree, 'prior-gpa'), '4.2'); tree = gpa.render(props);
assert.match(text(tree), /Enter prior credits and GPA/, 'Out-of-range history never enters cumulative calculations');
change(input(tree, 'prior-gpa'), '3.5'); tree = gpa.render(props);
await button(tree, 'Copied!').props.onClick(); assert.match(gpa.reports[1], /Prior Credits: 30 \(Prior GPA: 3.50\)/);
assert.match(gpa.reports[1], /Cumulative GPA: 3.57 \/ 4.00/);
button(tree, 'Common 4.33 conversion').props.onClick(); tree = gpa.render(props);
assert.equal(input(tree, 'prior-gpa').props.value, '4.20');
const creditInput = (t: any) => find(t, n => n.type === 'input' && n.props['aria-label'] === `Credits for ${course.course_code}`);
assert.equal(creditInput(tree).props.value, '5'); change(creditInput(tree), ''); tree = gpa.render(props);
assert.equal(creditInput(tree).props.value, '');
await creditInput(tree).props.onBlur({ target: { value: '' } }); assert.equal(gpa.writes.length, 0);
change(creditInput(tree), '6'); tree = gpa.render(props);
await creditInput(tree).props.onBlur({ target: { value: '6' } }); assert.equal(gpa.writes[0].credits, 6);
const remounted = await harness('UbcGpaConverter');
assert.equal(creditInput(remounted.render({ courseResults: [{ ...props.courseResults[0], course: gpa.writes[0] }] })).props.value, '6');
let release!: () => void;
gpa.pendingCopy(new Promise<void>(resolve => { release = resolve; }));
const pending = button(gpa.render(props), 'Copied!').props.onClick();
assert.ok(button(gpa.render(props), 'Export Report'), 'Copied is cleared while write is pending');
release(); await pending; assert.ok(button(gpa.render(props), 'Copied!'));
gpa.failCopy(); await button(gpa.render(props), 'Copied!').props.onClick(); tree = gpa.render(props);
assert.ok(button(tree, 'Export Report')); assert.match(input(tree, 'gpa-report').props.value, /CONVERSION REPORT/);
let selections = 0; input(tree, 'gpa-report').props.onFocus({ target: { select: () => selections++ } }); assert.equal(selections, 1);
gpa.missingCopy(); await button(tree, 'Export Report').props.onClick(); assert.ok(input(gpa.render(props), 'gpa-report'));
button(gpa.render(props), 'View conversion scale table').props.onClick(); tree = gpa.render(props);
assert.match(text(tree), /Letter bands: UBC Academic Calendar; GPA mapping: common 4.33 \/ OMSAS conventions \(UBC does not issue a GPA\)/);
assert.doesNotMatch(text(tree), /Official.*Conversion|UBC Official|Official Scale/);

const unknown = { ...DEMO_TASKS[0], course: 'TEST 101' };
const announcement = { ...unknown, task_id: 'notice', course: 'ANN 100', type: 'announcement' as const };
const shells = coursesWithTaskShells([], [unknown, announcement]);
assert.equal(shells.length, 1); assert.equal(hasConfirmedWeights(shells[0]), false);
assert.equal(hasConfirmedWeights({ ...shells[0], grade_categories: [{ id: 'final', name: 'Final', weight: 100 }] }), true);
assert.equal(normalizeCourse({ ...course, credits: 6 }, course.id).credits, 6);
assert.equal('credits' in normalizeCourse({ ...course, credits: NaN }, course.id), false);
const grades = await harness('GradesTab'); grades.context.tasks = [unknown, announcement];
tree = grades.render(); assert.match(text(tree), /default weights - not from your syllabus/i); assert.doesNotMatch(text(tree), /ANN 100/);
button(tree, 'Final Exam Calculator').props.onClick(); tree = grades.render();
assert.equal(find(tree, n => n.type === 'FinalExamCalculatorCard'), undefined);
assert.match(text(tree), /Confirm syllabus weights/);
grades.context.tasks = []; tree = grades.render(); button(tree, 'Upload syllabus').props.onClick(); assert.deepEqual(grades.imports, ['syllabus']);
assert.match(text(tree), /Add a score on any task, paste a Canvas grade email into Smart Import/);
const courses = await harness('CoursesList'); courses.context.tasks = [unknown, announcement]; tree = courses.render();
assert.match(text(tree), /TEST 101/); assert.doesNotMatch(text(tree), /ANN 100/);
assert.match(text(tree), /Default weights - not from your syllabus/);
console.log('Batch 17 grade filtering, course shells, prior history, scale bounds, credit persistence and clipboard behavior passed.');

const card = await harness('CourseGradeDetailCard');
tree = card.render({ course: shells[0], tasks: [unknown, announcement], onUpdateCourse: card.context.updateCourse, onEditTask: () => {} });
assert.match(text(tree), /Default weights - not from your syllabus/);
assert.equal(find(tree, n => n.type === 'select' && String(n.props.id).startsWith('target-grade-select-')), undefined);
assert.doesNotMatch(text(tree), /You need .*on the final|If you ace the rest|If you scrape by/);
assert.equal(find(tree, n => n.type === 'p' && text(n).includes(announcement.title) && text(n).includes('Announcement')), undefined);
console.log('Batch 17 default-weight course detail suppresses final exam recommendations.');

const rules = readFileSync('firestore.rules', 'utf8');
const courseRules = rules.slice(rules.indexOf('match /courses/{courseId}'), rules.indexOf('match /classes/{classId}'));
assert.match(courseRules, /allow create, update: if isOwner\(userId\)/);
assert.match(rules, /function isOwner\(userId\)\s*\{\s*return isAuthenticated\(\) && request.auth.uid == userId;/);
assert.match(rules, /function isAuthenticated\(\)\s*\{\s*return request.auth != null;/);
assert.match(courseRules, /keys\(\).hasOnly/);
assert.match(courseRules, /credits is number && request.resource.data.credits >= 0 && request.resource.data.credits <= 30/);
assert.equal('credits' in normalizeCourse({ ...course, credits: 31 }, course.id), false);
assert.equal('credits' in normalizeCourse({ ...course, credits: '6' }, course.id), false);
assert.equal('credits' in normalizeCourse({ ...course, credits: -1 }, course.id), false);
console.log('Batch 17 course credit schema preserves owner-only writes and bounded numeric validation.');
