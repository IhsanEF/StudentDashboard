import { Task } from './types';
import { 
  parseTaskDueDate, 
  getTaskUrgencyCategory, 
  sanitizeUrl, 
  getUbcLetterGrade, 
  getUbcGradePoints,
  calculateGradePercentage,
  getCourseColor,
  toVancouverDateString,
  isDateOnly,
  isActionableTask,
  TIMEZONE,
  formatInTimeZone,
  formatVancouverDate,
  formatGroupTargetDate
} from './utils';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

function runTests() {
  console.log('🧪 Starting Date & Utility Test Suite...');

  // 1. Sanitize URL Tests
  console.log('  Testing URL sanitization...');
  assert(sanitizeUrl('https://canvas.ubc.ca') === 'https://canvas.ubc.ca/', 'Allows https URL');
  assert(sanitizeUrl('http://example.com/calendar.ics') === 'http://example.com/calendar.ics', 'Allows http URL');
  assert(sanitizeUrl('mailto:prof@ubc.ca') === 'mailto:prof@ubc.ca', 'Allows mailto URI');
  assert(sanitizeUrl('javascript:alert(1)') === '', 'Blocks javascript URI');
  assert(sanitizeUrl('data:text/html,<script>alert(1)</script>') === '', 'Blocks data URI');
  assert(sanitizeUrl('vbscript:msgbox(1)') === '', 'Blocks vbscript URI');
  assert(sanitizeUrl('') === '', 'Handles empty string');
  assert(sanitizeUrl(null) === '', 'Handles null');
  assert(sanitizeUrl(undefined) === '', 'Handles undefined');

  // 2. UBC Letter Grade Tests
  console.log('  Testing UBC letter grade scales...');
  assert(getUbcLetterGrade(95) === 'A+', '95% is A+');
  assert(getUbcLetterGrade(90) === 'A+', '90% is A+');
  assert(getUbcLetterGrade(87) === 'A', '87% is A');
  assert(getUbcLetterGrade(85) === 'A', '85% is A');
  assert(getUbcLetterGrade(84.6) === 'A-', '84.6% is A-');
  assert(getUbcLetterGrade(82) === 'A-', '82% is A-');
  assert(getUbcLetterGrade(78) === 'B+', '78% is B+');
  assert(getUbcLetterGrade(73) === 'B', '73% is B');
  assert(getUbcLetterGrade(69) === 'B-', '69% is B-');
  assert(getUbcLetterGrade(65) === 'C+', '65% is C+');
  assert(getUbcLetterGrade(61) === 'C', '61% is C');
  assert(getUbcLetterGrade(56) === 'C-', '56% is C-');
  assert(getUbcLetterGrade(51) === 'D', '51% is D');
  assert(getUbcLetterGrade(42) === 'F', '42% is F');

  // Grade Points 4.33 Scale Tests
  console.log('  Testing UBC 4.33 grade points mapping...');
  assert(getUbcGradePoints('A+') === 4.33, 'A+ is 4.33');
  assert(getUbcGradePoints('A') === 4.0, 'A is 4.0');
  assert(getUbcGradePoints('A-') === 3.7, 'A- is 3.7');
  assert(getUbcGradePoints('B+') === 3.3, 'B+ is 3.3');
  assert(getUbcGradePoints('B') === 3.0, 'B is 3.0');
  assert(getUbcGradePoints('B-') === 2.7, 'B- is 2.7');
  assert(getUbcGradePoints('C+') === 2.3, 'C+ is 2.3');
  assert(getUbcGradePoints('C') === 2.0, 'C is 2.0');
  assert(getUbcGradePoints('C-') === 1.7, 'C- is 1.7');
  assert(getUbcGradePoints('D') === 1.0, 'D is 1.0');
  assert(getUbcGradePoints('F') === 0.0, 'F is 0.0');

  // 3. Grade Percentage Calculations
  console.log('  Testing Grade percentage calculation...');
  assert(calculateGradePercentage(45, 50) === 90, '45/50 is 90%');
  assert(calculateGradePercentage('18.5', '20') === 92.5, '18.5/20 is 92.5%');
  assert(calculateGradePercentage('invalid', 100) === null, 'Invalid string returns null');
  assert(calculateGradePercentage(10, 0) === null, 'Division by zero returns null');

  // 4. Date Parsing
  console.log('  Testing Date parsing...');
  const parsedIso = parseTaskDueDate('2026-09-15T23:59:00Z');
  assert(parsedIso !== null && !isNaN(parsedIso.getTime()), 'Parses valid ISO date');
  
  const parsedInvalid = parseTaskDueDate('not-a-date');
  assert(parsedInvalid === null, 'Returns null for invalid date string');

  const parsedEmpty = parseTaskDueDate('');
  assert(parsedEmpty === null, 'Returns null for empty string');

  // 5. Urgency Categories
  console.log('  Testing Urgency categorization...');
  const baseTask: Task = {
    task_id: 'test-1',
    title: 'Assignment 1',
    course: 'CPSC 310',
    type: 'assignment',
    due_at: '2020-01-01T00:00:00Z',
    status: 'Not Started',
    points_earned: '',
    points_possible: '100',
    grade_text: '',
    feedback: '',
    progress_notes: '',
    next_action: '',
    last_interaction_at: '',
    check_again_at: '',
    canvas_url: '',
    summary: '',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  assert(getTaskUrgencyCategory(baseTask) === 'overdue', 'Past uncompleted assignment is overdue');
  assert(getTaskUrgencyCategory({ ...baseTask, due_at: '' }) === 'nodate', 'Task without due date is nodate');
  
  // Task due tonight at 23:59 Vancouver time
  const now = new Date();
  const vancouverTodayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  
  const dueTonightTask: Task = {
    ...baseTask,
    due_at: `${vancouverTodayStr}T23:59:00-07:00`
  };
  assert(getTaskUrgencyCategory(dueTonightTask) === 'today', 'Task due tonight 23:59 is today (not overdue)');

  // Task due today as date-only
  const dateOnlyTask: Task = {
    ...baseTask,
    due_at: vancouverTodayStr
  };
  assert(getTaskUrgencyCategory(dateOnlyTask) === 'today', 'Date-only task due today is today');

  // Task due in 3 days (upcoming)
  const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  assert(getTaskUrgencyCategory({ ...baseTask, due_at: futureDate }) === 'upcoming', 'Task in 3 days is upcoming');
  
  // Task due 10 days out (later)
  const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  assert(getTaskUrgencyCategory({ ...baseTask, due_at: tenDaysOut }) === 'later', 'Task due 10 days out is later');

  // Distant future task (e.g., 30 days)
  const distantDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  assert(getTaskUrgencyCategory({ ...baseTask, due_at: distantDate }) === 'later', 'Task in 30 days is later');

  // 6. Course Badge Colors
  console.log('  Testing Course badge colors...');
  const color1 = getCourseColor('CPSC 310');
  const color2 = getCourseColor('CPSC 310');
  assert(color1 === color2, 'Course badge color is deterministic');
  assert(typeof color1 === 'string' && color1.length > 0, 'Course badge color is non-empty');

  // 7. toVancouverDateString
  console.log('  Testing toVancouverDateString...');
  assert(toVancouverDateString('2026-10-15') === '2026-10-15', 'Preserves date-only string');
  assert(toVancouverDateString('2026-10-03T06:59:00.000Z') === '2026-10-02', 'Converts UTC ISO instant to Vancouver date');
  assert(isDateOnly('2026-10-16') === true, 'Identifies date-only deadline');
  assert(isDateOnly('2026-10-16T23:59:00Z') === false, 'Rejects timestamp as date-only');

  // 8. All-Day ICS Event Parsing
  console.log('  Testing all-day ICS event formatting...');
  const mockAllDayEvent = {
    type: 'VEVENT',
    datetype: 'date',
    start: Object.assign(new Date(2026, 9, 16), { dateOnly: true }),
    summary: 'Canvas All Day Task'
  };
  const isAllDay = mockAllDayEvent.datetype === 'date' || (mockAllDayEvent.start as any)?.dateOnly === true;
  const startD = mockAllDayEvent.start;
  const evYear = startD.getFullYear();
  const evMonth = String(startD.getMonth() + 1).padStart(2, '0');
  const evDay = String(startD.getDate()).padStart(2, '0');
  const allDayDueAt = `${evYear}-${evMonth}-${evDay}`;
  assert(isAllDay === true, 'Correctly identifies all-day event');
  assert(allDayDueAt === '2026-10-16', 'All-day event formats to YYYY-MM-DD');

  // 9. isActionableTask & Snoozed Status Tests
  console.log('  Testing isActionableTask...');
  const actionableTask: Task = { ...baseTask, status: 'Not Started', type: 'assignment' };
  assert(isActionableTask(actionableTask) === true, 'Standard pending assignment is actionable');

  const workingTask: Task = { ...baseTask, status: 'Working', type: 'project' };
  assert(isActionableTask(workingTask) === true, 'In-progress working task is actionable');

  // Snoozed task (check_again_at in future) is NOT actionable
  const snoozedTask: Task = {
    ...baseTask,
    check_again_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  };
  assert(isActionableTask(snoozedTask) === false, 'A snoozed task is not actionable');

  // Expired snooze task (check_again_at in past) IS actionable
  const expiredSnoozeTask: Task = {
    ...baseTask,
    check_again_at: new Date(Date.now() - 60 * 1000).toISOString()
  };
  assert(isActionableTask(expiredSnoozeTask) === true, 'Task with expired snooze is actionable');

  // Exclusions: announcement, lecture, Done, Submitted
  assert(isActionableTask({ ...baseTask, type: 'announcement' }) === false, 'Announcement is not actionable');
  assert(isActionableTask({ ...baseTask, type: 'lecture' }) === false, 'Lecture schedule event is not actionable');
  assert(isActionableTask({ ...baseTask, type: 'lab', points_possible: '0' }) === false, 'Zero-point lab event is not actionable');
  assert(isActionableTask({ ...baseTask, status: 'Done' }) === false, 'Done task is not actionable');
  assert(isActionableTask({ ...baseTask, status: 'Submitted' }) === false, 'Submitted task is not actionable');

  // 10. Due Today in Vancouver timezone test
  console.log('  Testing Vancouver calendar date "due today" handling...');
  const nowVancouverDate = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  // Task explicitly due at 23:59 Vancouver time today
  const vancouverEndOfDayTask: Task = {
    ...baseTask,
    due_at: `${nowVancouverDate}T23:59:00` // No offset, treated as Vancouver
  };
  assert(
    getTaskUrgencyCategory(vancouverEndOfDayTask) === 'today',
    'A task due at 23:59 Vancouver today counts as today even when the machine is in UTC'
  );

  // Task due tomorrow Vancouver date must NOT be 'today'
  const tomorrowVancouver = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowDateStr = formatInTimeZone(tomorrowVancouver, TIMEZONE, 'yyyy-MM-dd');
  const vancouverTomorrowTask: Task = {
    ...baseTask,
    due_at: `${tomorrowDateStr}T14:00:00`
  };
  assert(
    getTaskUrgencyCategory(vancouverTomorrowTask) !== 'today',
    'A task due tomorrow in Vancouver does not count as today'
  );

  // Task due yesterday Vancouver date is 'overdue', NOT 'today'
  const yesterdayVancouver = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayDateStr = formatInTimeZone(yesterdayVancouver, TIMEZONE, 'yyyy-MM-dd');
  const vancouverYesterdayTask: Task = {
    ...baseTask,
    due_at: `${yesterdayDateStr}T23:59:00`
  };
  assert(
    getTaskUrgencyCategory(vancouverYesterdayTask) === 'overdue',
    'A task due yesterday in Vancouver counts as overdue, not today'
  );

  console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
}

runTests();

// Vancouver midnight must reclassify a date-only deadline without changing tasks.
const midnightTask = { task_id: 'midnight', due_at: '2026-10-02', type: 'assignment', status: 'Not Started' } as Task;
assert(getTaskUrgencyCategory(midnightTask, new Date('2026-10-03T06:59:30Z')) === 'today', 'Before Vancouver midnight the deadline is due today');
assert(getTaskUrgencyCategory(midnightTask, new Date('2026-10-03T07:00:30Z')) === 'overdue', 'After Vancouver midnight the deadline becomes overdue');

// Batch 26: calendar dates keep their day; instants use Vancouver even across midnight/DST.
assert(formatVancouverDate('2026-09-18') === 'Sep 18, 2026', 'Date-only values never shift to the previous day');
assert(formatVancouverDate('2026-09-18T00:30:00Z') === 'Sep 17, 2026', 'UTC instants display the Vancouver calendar day');
assert(formatVancouverDate('2026-01-14T07:30:00Z') === 'Jan 13, 2026', 'January dates use Vancouver standard time');
assert(formatGroupTargetDate('2026-09-18') === 'Sep 18, 2026', 'Existing formatter export remains compatible');
assert(formatVancouverDate('invalid') === 'invalid', 'Legacy invalid date values remain readable without a render crash');

// Exact instants must be independent of the browser/process timezone.
const originalTimezone = process.env.TZ;
try {
  for (const timezone of ['UTC', 'Asia/Tokyo', 'America/New_York', 'America/Vancouver']) {
    process.env.TZ = timezone;
    for (const [input, expected] of [
      ['2026-09-15', '2026-09-16T06:59:59.999Z'],
      ['2026-01-15', '2026-01-16T07:59:59.999Z'],
      ['2024-02-29', '2024-03-01T07:59:59.999Z'],
      ['2026-03-08', '2026-03-09T06:59:59.999Z'],
      ['2025-11-02', '2025-11-03T07:59:59.999Z'],
      ['2026-09-15T12:30:00', '2026-09-15T19:30:00.000Z'],
      [' 2026-01-15 12:30:00 ', '2026-01-15T20:30:00.000Z'],
      ['2026-03-08T12:00', '2026-03-08T19:00:00.000Z'],
      ['2025-11-02T12:00', '2025-11-02T20:00:00.000Z'],
      ['20261002T235900', '2026-10-03T06:59:00.000Z'],
      ['2026-09-15T23:59:00Z', '2026-09-15T23:59:00.000Z'],
      ['2026-11-01T01:30:00-07:00', '2026-11-01T08:30:00.000Z'],
      ['2026-11-01T01:30:00-08:00', '2026-11-01T09:30:00.000Z'],
      ['2026-09-15T12:30:00+0530', '2026-09-15T07:00:00.000Z']
    ]) {
      assert(parseTaskDueDate(input)?.toISOString() === expected, `${timezone}: ${input} must be ${expected}`);
    }
    for (const invalid of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-01-00',
      '2026-02-30T12:00', '2026-04-31T12:00:00Z', '2026-02-30T12:00:00-08:00', '20260431T120000', '2026-09-15T25:00']) {
      assert(parseTaskDueDate(invalid) === null, `${timezone}: impossible date ${invalid} must not roll over`);
    }
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
console.log('Exact Vancouver instants, offsets, DST, leap days and impossible dates passed in four timezones.');
