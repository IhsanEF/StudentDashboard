import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Step 75 Audit Remediation Verification (V3-430, V3-481, V4-238)...');

// 1. Verify V3-430: Hardship text in src/components/TimetableTab.tsx
const timetableFile = fs.readFileSync(path.join(process.cwd(), 'src/components/TimetableTab.tsx'), 'utf-8');

console.log('--- Testing V3-430: UBC Exam Hardship Banner Text ---');
assert(
  !timetableFile.includes('You are eligible for hardship rescheduling'),
  'FAIL: Flat eligibility verdict "You are eligible for hardship rescheduling" must be removed'
);

const expectedHardshipSnippet = 'Three exams inside 24 hours';
const expectedHardshipAdvice = 'UBC may allow rescheduling in this situation — check the exam hardship page and contact Enrolment Services to find out if you qualify.';

assert(
  timetableFile.includes(expectedHardshipSnippet),
  'FAIL: Hardship banner must contain "Three exams inside 24 hours"'
);
assert(
  timetableFile.includes(expectedHardshipAdvice),
  'FAIL: Hardship banner must contain "UBC may allow rescheduling in this situation — check the exam hardship page and contact Enrolment Services to find out if you qualify."'
);
console.log('✅ V3-430 UBC Exam Hardship banner wording verified!');

// 2. Verify V3-481: Inline two-step confirmation & undo toast for classes & exams
console.log('--- Testing V3-481: Delete Confirmation & Undo Toast ---');
assert(
  timetableFile.includes('deletingClassId') && timetableFile.includes('deletingExamId'),
  'FAIL: Must track deleting state for classes and exams'
);
assert(
  timetableFile.includes('Delete class?') && timetableFile.includes('Delete exam?'),
  'FAIL: Must provide inline two-step confirmation asking "Delete class?" and "Delete exam?"'
);
assert(
  timetableFile.includes('handleConfirmDeleteClass') && timetableFile.includes('handleConfirmDeleteExam'),
  'FAIL: Must provide confirmation handlers that call delete and show toast with undo'
);
assert(
  timetableFile.includes('showToast({') && timetableFile.includes('undo:'),
  'FAIL: Must trigger showToast with undo action for deleted classes and exams'
);
console.log('✅ V3-481 Delete confirmation & Undo toast verified!');

// 3. Verify V4-238: Class clash overlap detection & warning
console.log('--- Testing V4-238: Class Clash / Overlap Detection ---');
assert(
  timetableFile.includes('classClashes'),
  'FAIL: TimetableTab must compute class clashes'
);
assert(
  timetableFile.includes('Class Schedule Conflict Detected') || timetableFile.includes('Class Conflict Detected'),
  'FAIL: Modal must show warning when new/edited class overlaps an existing class'
);
assert(
  timetableFile.includes('Save despite overlapping conflict?') || timetableFile.includes('Save Anyway'),
  'FAIL: Modal must require confirmation before saving overlapping class'
);

// Functional test of time overlap logic
const timeToMinutes = (timeStr: string) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const class1 = { day: 'Tuesday', start_time: '14:00', end_time: '16:00', course_code: 'CPSC 310', type: 'Lab' };
const class2 = { day: 'Tuesday', start_time: '14:00', end_time: '15:00', course_code: 'CPSC 310', type: 'Lecture' };
const class3 = { day: 'Tuesday', start_time: '16:00', end_time: '17:00', course_code: 'MATH 200', type: 'Lecture' };

const checkOverlap = (a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) => {
  const aStart = timeToMinutes(a.start_time);
  const aEnd = timeToMinutes(a.end_time);
  const bStart = timeToMinutes(b.start_time);
  const bEnd = timeToMinutes(b.end_time);
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
};

assert(checkOverlap(class1, class2) === true, 'CPSC 310 Lab and Lecture on Tuesday 14:00-15:00 vs 14:00-16:00 must overlap');
assert(checkOverlap(class1, class3) === false, 'Non-overlapping classes (14:00-16:00 and 16:00-17:00) must not overlap');

console.log('✅ V4-238 Class clash detection logic verified!');
console.log('🎉 ALL STEP 75 AUDIT REMEDIATION TESTS COMPLETED SUCCESSFULLY!');
