import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateLocalDraft } from './QuickAddModal';
import { generateLocalDraft as activeDraft } from './AddTaskModal';
import { isValidInstructorEmail } from './CoursesList';
import ImportWorkloadWarning from './ImportWorkloadWarning';
import { checkDateWorkloadImpact, getImportWorkloadWarnings } from '../services/workloadService';
import { Task } from '../types';
import { DEMO_TASKS } from '../demoData';
import { getTaskUrgencyCategory, toVancouverDateString } from '../utils';

for (const email of ['prof@ubc.ca', 'prof+course@cs.ubc.ca']) assert.equal(isValidInstructorEmail(email), true);
for (const email of ['', 'not an email', 'prof@ubc.ca?subject=spoof', 'prof@ubc.ca&bcc=evil@example.com', 'prof@ubc.ca\r\nBcc: evil@example.com']) assert.equal(isValidInstructorEmail(email), false);

const ref = new Date('2026-10-02T19:00:00Z');
for (const text of ['MATH 200 problem set due yesterday', 'MATH 200 problem set', 'MATH 200 problem set due last Friday', 'MATH 200 problem set due today at 9am']) {
  const draft = generateLocalDraft(text, [], true, ref);
  assert.equal(draft.due_at, '', `${text}: requires a chosen date`);
  assert.equal(draft.dateUnrecognised, true);
}
for (const text of ['MATH 200 problem set due yesterday', 'MATH 200 problem set']) {
  assert.equal(activeDraft(text).due_at, '', 'Active modal also rejects missing/past dates');
}
const valid = generateLocalDraft('CHEM 233 lab report due next Friday ~3h worth 10%', [], true, ref);
assert.equal(valid.due_at, '2026-10-09T23:59');
assert.equal(valid.estimated_hours, 3);
assert.equal(valid.weight, 10);
assert.equal(valid.summary, '');
assert.equal(valid.canvas_url, '');
const utc = generateLocalDraft('MATH 200 quiz due tomorrow', [], true, new Date('2026-10-03T02:00:00Z'));
assert.equal(utc.due_at, '2026-10-03T23:59', 'Relative dates use Vancouver calendar dates');
const demo = DEMO_TASKS.find(t => t.task_id === 'demo-2')!;
assert.equal(getTaskUrgencyCategory(demo, new Date()), 'today');

const due = `${toVancouverDateString(new Date())}T23:59`;
function task(id: string, hours: number, overrides: Partial<Task> = {}): Task {
  return { ...demo, task_id: id, type: 'assignment', status: 'Not Started', due_at: due, estimated_hours: hours, ...overrides };
}
const existing = [task('existing', 12)];
assert.equal(checkDateWorkloadImpact(existing, due, 3, 15).willOverload, false, 'Exactly 15h does not exceed the limit');
assert.equal(checkDateWorkloadImpact(existing, due, 6, 15).willOverload, true);
assert.equal(getImportWorkloadWarnings(existing, [task('a', 2), task('b', 2)], 15)[0]?.newTotalHours, 16, 'Selected imports accumulate together');
assert.equal(getImportWorkloadWarnings(existing, [task('a', 3)], 15).length, 0);
assert.equal(getImportWorkloadWarnings(existing, [task('a', 9, {status:'Done'}), task('b', 9, {type:'announcement'})], 15).length, 0, 'Inactive and nonactionable imports do not add workload');
assert.equal(getImportWorkloadWarnings([task('same', 12)], [task('same', 6)], 15).length, 0, 'Replacing an existing ID does not count twice');
assert.equal(getImportWorkloadWarnings([task('same', 12)], [task('same', 6), task('new', 6)], 15).length, 0, 'Other imported rows use the replacement load rather than the old task');
const html = renderToStaticMarkup(<ImportWorkloadWarning existingTasks={existing} selectedTasks={[task('a', 6)]} thresholdHours={15} />);
assert.match(html, /role="status"/);
assert.match(html, /18h, exceeding your 15h/);
assert.equal(renderToStaticMarkup(<ImportWorkloadWarning existingTasks={existing} selectedTasks={[task('a',3)]} thresholdHours={15} />), '');
console.log('Batch 13 date, demo, workload and import preview regression checks passed.');
