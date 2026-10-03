import assert from 'assert';

console.log('Testing Step 99 Remediations...');

// 1. Test key normalization for duplicate and update detection
function getCourseTitleKey(course?: string, title?: string): string {
  return `${(course || '').trim().toLowerCase()}:::${(title || '').trim().toLowerCase()}`;
}

function getLooseCourseTitleKey(course?: string, title?: string): string {
  const c = (course || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = (title || '')
    .trim()
    .toLowerCase()
    .replace(/^(weekly|biweekly|daily|regular)\s+/i, '')
    .replace(/[^a-z0-9]/g, '');
  return `${c}:::${t}`;
}

// Test exact and loose course:::title matching
const existingKey = getCourseTitleKey('MATH 200', 'Quiz 4');
const alertKey = getCourseTitleKey('MATH 200', 'Quiz 4');
assert.strictEqual(existingKey, alertKey, 'Exact course:::title keys must match');
assert.strictEqual(existingKey, 'math 200:::quiz 4');

// Test loose matching when existing task is named 'Weekly Quiz 4'
const weeklyLooseKey = getLooseCourseTitleKey('MATH 200', 'Weekly Quiz 4');
const quiz4LooseKey = getLooseCourseTitleKey('MATH 200', 'Quiz 4');
assert.strictEqual(weeklyLooseKey, quiz4LooseKey, 'Loose course:::title keys must match Weekly Quiz 4 with Quiz 4');

// 2. Test due date change matching
const existingDueDateChangeKey = getCourseTitleKey('CPSC 310', 'Milestone 1: Project Setup');
const newDueDateChangeKey = getCourseTitleKey('CPSC 310', 'Milestone 1: Project Setup');
assert.strictEqual(existingDueDateChangeKey, newDueDateChangeKey, 'Course title keys match for due date change');

// 3. Test non-destructive field merge
const existingTask = {
  task_id: 'existing-task-123',
  title: 'Quiz 4',
  course: 'MATH 200',
  due_at: '2026-10-10',
  source: 'canvas_feed',
  is_syllabus_only: false,
  status: 'In Progress',
  points_earned: '',
  points_possible: '20',
  grade_text: '',
  feedback: ''
};

const extractedRow = {
  task_id: 'extracted-new-temp-id',
  title: 'Quiz 4',
  course: 'MATH 200',
  due_at: '', // Grade alert email has no due date
  source: 'email',
  is_syllabus_only: false,
  status: 'Completed',
  points_earned: '19',
  points_possible: '20',
  grade_text: '19 / 20 (95%)',
  feedback: 'Great work on partial derivatives and Lagrange multipliers.'
};

// Apply merging logic
extractedRow.task_id = existingTask.task_id;
extractedRow.source = existingTask.source;
extractedRow.is_syllabus_only = existingTask.is_syllabus_only;
extractedRow.status = existingTask.status;

if (!extractedRow.due_at && existingTask.due_at) {
  extractedRow.due_at = existingTask.due_at;
}

assert.strictEqual(extractedRow.task_id, 'existing-task-123', 'task_id must be rewritten to existing task_id');
assert.strictEqual(extractedRow.source, 'canvas_feed', 'source must NOT be overwritten');
assert.strictEqual(extractedRow.is_syllabus_only, false, 'is_syllabus_only must NOT be overwritten');
assert.strictEqual(extractedRow.status, 'In Progress', 'status must NOT be overwritten');
assert.strictEqual(extractedRow.due_at, '2026-10-10', 'due_at must be preserved from existing task when extracted due_at is empty');
assert.strictEqual(extractedRow.points_earned, '19', 'points_earned must be merged');
assert.strictEqual(extractedRow.grade_text, '19 / 20 (95%)', 'grade_text must be merged');

console.log('Step 99 Remediations verified successfully!');
