import { 
  isQuietHoursActive, 
  formatLeadTimeText, 
  evaluateNotifications, 
  generateDigestPreview,
  clearFiredHistory 
} from './notificationService';
import { Task, NotificationPrefs, DEFAULT_NOTIFICATION_PREFS } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

// Mock simple localStorage for Node/tsx execution if window is undefined
if (typeof window === 'undefined') {
  const store: Record<string, string> = {};
  (global as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

function runNotificationTests() {
  console.log('🧪 Starting Notification & Deadline Reminders Test Suite...');
  const mockUserId = 'test_student_ubc_123';
  clearFiredHistory(mockUserId);
  localStorage.clear();

  // 1. Lead Time Formatting
  console.log('  Testing lead time duration formatting...');
  assert(formatLeadTimeText(15) === '15 minutes', '15m formatting');
  assert(formatLeadTimeText(60) === '1 hour', '60m formatting');
  assert(formatLeadTimeText(180) === '3 hours', '180m formatting');
  assert(formatLeadTimeText(1440) === '1 day', '1440m formatting');
  assert(formatLeadTimeText(2880) === '2 days', '2880m formatting');
  assert(formatLeadTimeText(10080) === '1 week', '10080m formatting');

  // 2. Quiet Hours in Vancouver Time
  console.log('  Testing quiet hours in America/Vancouver timezone...');
  const quietPrefs: NotificationPrefs['quietHours'] = {
    enabled: true,
    start: '23:00',
    end: '08:00'
  };

  // 2:00 AM PDT (09:00 UTC) -> should be quiet hours
  const nightDate = new Date('2026-09-02T09:00:00Z');
  assert(isQuietHoursActive(quietPrefs, nightDate) === true, '2 AM Vancouver is quiet hours');

  // 2:00 PM PDT (21:00 UTC) -> should NOT be quiet hours
  const dayDate = new Date('2026-09-02T21:00:00Z');
  assert(isQuietHoursActive(quietPrefs, dayDate) === false, '2 PM Vancouver is not quiet hours');

  // Disabled quiet hours
  assert(isQuietHoursActive({ enabled: false, start: '23:00', end: '08:00' }, nightDate) === false, 'Disabled quiet hours always returns false');

  // 3. Deadline Reminder Triggering & Deduplication
  console.log('  Testing deadline reminder evaluation and deduplication...');
  const now = new Date('2026-09-02T21:00:00Z'); // 2:00 PM PDT
  const dueIso = new Date('2026-09-02T21:45:00Z').toISOString(); // 2:45 PM PDT (45 mins away)

  const activeTask: Task = {
    task_id: 'task-cpsc-310-a1',
    type: 'assignment',
    title: 'Assignment 1',
    course: 'CPSC 310',
    due_at: dueIso,
    status: 'Working',
    check_again_at: '',
    canvas_url: '',
    summary: '',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    points_earned: '',
    points_possible: '',
    grade_text: '',
    feedback: '',
    progress_notes: '',
    next_action: '',
    last_interaction_at: ''
  };

  const prefs: NotificationPrefs = {
    ...DEFAULT_NOTIFICATION_PREFS,
    enabled: true,
    channels: { inApp: true, email: false, push: false },
    leadTimes: [60], // 1 hour before
    quietHours: { enabled: false, start: '23:00', end: '08:00' }
  };

  const eval1 = evaluateNotifications({
    tasks: [activeTask],
    prefs,
    userId: mockUserId,
    currentNotifications: [],
    now
  });

  assert(eval1.newNotifications.length === 1, 'Triggers 1 notification for due task');
  assert(eval1.newNotifications[0].taskId === 'task-cpsc-310-a1', 'Notification linked to correct taskId');
  assert(eval1.newNotifications[0].courseCode === 'CPSC 310', 'Notification has correct course code');

  // Second run must deduplicate and return 0
  const eval2 = evaluateNotifications({
    tasks: [activeTask],
    prefs,
    userId: mockUserId,
    currentNotifications: eval1.newNotifications,
    now
  });

  assert(eval2.newNotifications.length === 0, 'Deduplication prevents re-firing identical reminder');

  // 4. Completed & Submitted Tasks Ignored
  console.log('  Testing exclusion of completed tasks...');
  const doneTask: Task = { ...activeTask, task_id: 'task-done-1', status: 'Done' };
  const submittedTask: Task = { ...activeTask, task_id: 'task-sub-1', status: 'Submitted' };

  const evalDone = evaluateNotifications({
    tasks: [doneTask, submittedTask],
    prefs,
    userId: mockUserId,
    currentNotifications: [],
    now
  });

  assert(evalDone.newNotifications.length === 0, 'Completed and submitted tasks do not trigger notifications');

  // 5. Quiet Hours Same-Night Deadline Exemption & Deferral
  console.log('  Testing quiet hours same-night deadline exemption & deferral...');
  const quietEvalPrefs: NotificationPrefs = {
    ...DEFAULT_NOTIFICATION_PREFS,
    enabled: true,
    channels: { inApp: true, email: false, push: false },
    leadTimes: [60, 180], // 1 hour and 3 hours
    quietHours: { enabled: true, start: '23:00', end: '08:00' }
  };

  // Test Case 5a: Same-night deadline (23:59:00 Vancouver time) evaluated during quiet hours at 23:15:00
  // Vancouver is UTC-7 in September (PDT)
  const quietNowNight = new Date('2026-09-03T06:15:00Z'); // 23:15 Vancouver time (inside quiet hours)
  const sameNightTask: Task = {
    ...activeTask,
    task_id: 'task-same-night-1',
    title: 'Midnight WebWork',
    due_at: '2026-09-02T23:59:00-07:00' // 23:59 Vancouver time (deadline inside quiet hours)
  };

  const evalSameNight = evaluateNotifications({
    tasks: [sameNightTask],
    prefs: quietEvalPrefs,
    userId: 'user-same-night-test',
    currentNotifications: [],
    now: quietNowNight
  });

  assert(
    evalSameNight.newNotifications.length === 1,
    'Exempt same-night deadline: 1-hour reminder is NOT suppressed during quiet hours'
  );
  assert(
    evalSameNight.newNotifications[0].leadMinutes === 60,
    'Exempt notification is the 1-hour reminder'
  );

  // Test Case 5b: Non-exempt task during quiet hours (due 10:00 AM, evaluated at 07:00 AM with 3-hour lead time)
  const quietNowMorning = new Date('2026-09-03T14:00:00Z'); // 07:00 AM Vancouver time (inside quiet hours)
  const morningTask: Task = {
    ...activeTask,
    task_id: 'task-morning-1',
    title: 'Morning Lab Report',
    due_at: '2026-09-03T10:00:00-07:00' // 10:00 AM Vancouver time (deadline outside quiet hours)
  };

  const evalSuppressed = evaluateNotifications({
    tasks: [morningTask],
    prefs: quietEvalPrefs,
    userId: 'user-deferral-test',
    currentNotifications: [],
    now: quietNowMorning
  });

  assert(
    evalSuppressed.newNotifications.length === 0,
    'Non-exempt reminder during quiet hours is suppressed and recorded as deferred'
  );

  // Test Case 5c: First evaluation after quiet hours ends (08:01 AM Vancouver time)
  const afterQuietHours = new Date('2026-09-03T15:01:00Z'); // 08:01 AM Vancouver time (quiet hours ended at 08:00)
  const evalDeferred = evaluateNotifications({
    tasks: [morningTask],
    prefs: quietEvalPrefs,
    userId: 'user-deferral-test',
    currentNotifications: [],
    now: afterQuietHours
  });

  assert(
    evalDeferred.newNotifications.length === 1,
    'Deferred reminder fires at the first evaluation after quiet hours end while task is still upcoming'
  );
  assert(
    evalDeferred.newNotifications[0].taskId === 'task-morning-1',
    'Fired deferred reminder matches the pending task'
  );

  // Test Case 5d: Expired task during quiet hours does NOT fire after quiet hours ends
  const overnightPastTask: Task = {
    ...activeTask,
    task_id: 'task-past-overnight-1',
    title: 'Midnight Quiz',
    due_at: '2026-09-03T03:00:00-07:00' // 3:00 AM Vancouver time
  };
  const at1AM = new Date('2026-09-03T08:00:00Z'); // 01:00 AM Vancouver time (diff is 2 hours <= 180 min, not exempt since 180 min)
  evaluateNotifications({
    tasks: [overnightPastTask],
    prefs: quietEvalPrefs,
    userId: 'user-expired-test',
    currentNotifications: [],
    now: at1AM
  });

  const evalPastAfterQuiet = evaluateNotifications({
    tasks: [overnightPastTask],
    prefs: quietEvalPrefs,
    userId: 'user-expired-test',
    currentNotifications: [],
    now: afterQuietHours // 08:01 AM (deadline 03:00 AM already passed)
  });

  assert(
    evalPastAfterQuiet.newNotifications.length === 0,
    'Deferred reminder whose deadline passed during quiet hours does not fire'
  );

  // 6. Daily and Weekly Digest Previews
  console.log('  Testing automated digest generation...');
  const taskDueToday: Task = {
    ...activeTask,
    task_id: 'task-today-1',
    due_at: '2026-09-02T23:59:00-07:00'
  };
  const taskDueNextWeek: Task = {
    ...activeTask,
    task_id: 'task-future-1',
    due_at: '2026-09-06T23:59:00-07:00'
  };

  const dailyPreview = generateDigestPreview('daily', [taskDueToday, taskDueNextWeek], now);
  assert(dailyPreview.count === 1, 'Daily digest contains only today deadlines');
  assert(dailyPreview.tasks[0].task_id === 'task-today-1', 'Daily digest has correct task');

  const weeklyPreview = generateDigestPreview('weekly', [taskDueToday, taskDueNextWeek], now);
  assert(weeklyPreview.count === 2, 'Weekly digest contains all upcoming 7-day deadlines');

  console.log('✅ ALL NOTIFICATION TESTS PASSED SUCCESSFULLY!\n');
}

runNotificationTests();
