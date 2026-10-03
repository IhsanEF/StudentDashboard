import { Task } from '../types';
import { pickNextTasks } from './focusService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

function createTask(overrides: Partial<Task>): Task {
  return {
    task_id: overrides.task_id || `task-${Math.random().toString(36).substring(2, 9)}`,
    title: overrides.title || 'Sample Task',
    course: overrides.course || 'CPSC 310',
    type: overrides.type || 'assignment',
    due_at: overrides.due_at !== undefined ? overrides.due_at : '2026-10-15T23:59:00Z',
    status: overrides.status || 'Not Started',
    points_earned: overrides.points_earned || '',
    points_possible: overrides.points_possible !== undefined ? overrides.points_possible : '100',
    grade_text: overrides.grade_text || '',
    feedback: overrides.feedback || '',
    progress_notes: overrides.progress_notes || '',
    next_action: overrides.next_action || '',
    last_interaction_at: overrides.last_interaction_at || '',
    check_again_at: overrides.check_again_at || '',
    canvas_url: overrides.canvas_url || '',
    summary: overrides.summary || '',
    source_message_id: overrides.source_message_id || '',
    last_email_at: overrides.last_email_at || '',
    needs_review: overrides.needs_review !== undefined ? overrides.needs_review : false,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString()
  };
}

function runFocusServiceTests() {
  console.log('🧪 Starting Focus Service Test Suite...');

  // 1. Exclusions
  console.log('  Testing exclusions...');
  const activeTask = createTask({ task_id: 't-active', title: 'Active Assignment' });
  const announcement = createTask({ task_id: 't-ann', type: 'announcement', title: 'Course Announcement' });
  const lecture = createTask({ task_id: 't-lec', type: 'lecture', title: 'Lecture 1' });
  const labZero = createTask({ task_id: 't-lab0', type: 'lab', points_possible: '0', title: 'Lab 0 (Attendance)' });
  const doneTask = createTask({ task_id: 't-done', status: 'Done', title: 'Done Task' });
  const submittedTask = createTask({ task_id: 't-sub', status: 'Submitted', title: 'Submitted Task' });
  const futureSnooze = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const snoozedTask = createTask({ task_id: 't-snoozed', check_again_at: futureSnooze, title: 'Snoozed Task' });
  const pastSnooze = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const unsnoozedTask = createTask({ task_id: 't-unsnoozed', check_again_at: pastSnooze, title: 'Past Snoozed Task' });

  const mixedTasks = [
    announcement,
    lecture,
    labZero,
    doneTask,
    submittedTask,
    snoozedTask,
    activeTask,
    unsnoozedTask
  ];

  const filtered = pickNextTasks(mixedTasks);
  const ids = filtered.map(t => t.task_id);
  assert(ids.includes('t-active'), 'Includes active assignment');
  assert(ids.includes('t-unsnoozed'), 'Includes expired snooze task');
  assert(!ids.includes('t-ann'), 'Excludes announcements');
  assert(!ids.includes('t-lec'), 'Excludes lectures');
  assert(!ids.includes('t-lab0'), 'Excludes zero-point labs');
  assert(!ids.includes('t-done'), 'Excludes Done tasks');
  assert(!ids.includes('t-sub'), 'Excludes Submitted tasks');
  assert(!ids.includes('t-snoozed'), 'Excludes snoozed tasks');
  assert(filtered.length === 2, `Expected 2 tasks, got ${filtered.length}`);

  // 2. Working first
  console.log('  Testing "Working" priority...');
  const earlierNotStarted = createTask({
    task_id: 't-early',
    title: 'Due Early Not Started',
    status: 'Not Started',
    due_at: '2026-09-10T12:00:00Z'
  });
  const laterWorking = createTask({
    task_id: 't-working',
    title: 'Due Later Working',
    status: 'Working',
    due_at: '2026-09-20T12:00:00Z'
  });

  const orderedByWorking = pickNextTasks([earlierNotStarted, laterWorking]);
  assert(orderedByWorking[0].task_id === 't-working', 'Working status takes priority over earlier due date');
  assert(orderedByWorking[1].task_id === 't-early', 'Earlier due date follows Working tasks');

  // 3. Earliest due date ordering
  console.log('  Testing earliest due date ordering...');
  const taskDueOct1 = createTask({ task_id: 't-oct1', due_at: '2026-10-01T23:59:00Z' });
  const taskDueOct15 = createTask({ task_id: 't-oct15', due_at: '2026-10-15T23:59:00Z' });
  const taskDueOct5 = createTask({ task_id: 't-oct5', due_at: '2026-10-05T23:59:00Z' });
  const taskNoDate = createTask({ task_id: 't-nodate', due_at: '' });

  const sortedTasks = pickNextTasks([taskDueOct15, taskNoDate, taskDueOct1, taskDueOct5]);
  assert(sortedTasks[0].task_id === 't-oct1', 'Oct 1 is first');
  assert(sortedTasks[1].task_id === 't-oct5', 'Oct 5 is second');
  assert(sortedTasks[2].task_id === 't-oct15', 'Oct 15 is third');
  assert(sortedTasks[3].task_id === 't-nodate', 'Tasks with no due date come last');

  // 4. Edge cases: empty / non-array
  console.log('  Testing edge cases...');
  assert(pickNextTasks([]).length === 0, 'Empty array returns empty array');
  assert(pickNextTasks(null as any).length === 0, 'Null returns empty array');
  assert(pickNextTasks(undefined as any).length === 0, 'Undefined returns empty array');

  console.log('✅ ALL FOCUS SERVICE TESTS PASSED SUCCESSFULLY!');
}

runFocusServiceTests();
