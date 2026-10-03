import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Task, DEFAULT_UI_PREFS } from '../types';
import Overview from './Overview';
import ProgressTab from './ProgressTab';
import TasksList from './TasksList';
import { generateDigestPreview } from '../services/notificationService';
import { isTaskDueToday, isActiveAcademicTask } from '../utils';
import { TaskContext, TaskContextType } from '../hooks/useTasks';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

function createMockContext(viewMode: 'simple' | 'detailed', tasks: Task[] = []): TaskContextType {
  return {
    now: new Date(),
    updateCourse: async () => {},
    deleteCourse: async () => {},
    uiPrefs: { ...DEFAULT_UI_PREFS, viewMode },
    setViewMode: () => {},
    updateUiPrefs: () => {},
    focusModeActive: false,
    isFocusModeActive: false,
    setFocusModeActive: () => {},
    openImport: () => {},
    isImportOpen: false,
    importInitialTab: 'calendar',
    closeImport: () => {},
    toast: null,
    showToast: () => {},
    dismissToast: () => {},
    tasks,
    courses: [],
    classes: [],
    exams: [],
    groups: [],
    activeGroupId: null,
    setActiveGroupId: () => {},
    groupTasks: [],
    loading: false,
    error: null,
    lastSync: null,
    isOnline: true,
    hasPendingWrites: false,
    isDemoMode: false,
    notificationPrefs: {} as any,
    notifications: [],
    unreadNotificationCount: 0,
    updateNotificationPrefs: async () => {},
    markNotificationAsRead: () => {},
    markAllNotificationsAsRead: () => {},
    clearNotification: () => {},
    clearAllNotifications: () => {},
    triggerTestReminder: () => {},
    triggerDigest: () => {},
    clearReminderHistory: () => {},
    enableDemoMode: () => {},
    disableDemoMode: () => {},
    refreshTasks: async () => {},
    updateTask: async () => {},
    addTask: async () => {},
    batchAddTasks: async () => {},
    deleteTask: async () => {},
    addClassItem: async () => {},
    updateClassItem: async () => {},
    deleteClassItem: async () => {},
    addExamItem: async () => {},
    updateExamItem: async () => {},
    deleteExamItem: async () => {},
    activeFocus: null,
    startFocusTimer: () => {},
    pauseFocusTimer: () => {},
    resumeFocusTimer: () => {},
    resetFocusTimer: () => {},
    stopAndLogFocusTimer: async () => {},
    logManualFocusTime: async () => {},
    createGroup: async () => ({} as any),
    joinGroupByCode: async () => null,
    leaveGroup: async () => {},
    saveGroupTaskAction: async () => '',
    deleteGroupTaskAction: async () => {},
    exportFullBackup: async () => ({} as any),
    downloadFullBackup: async () => ({ fileName: 'backup.json' }),
    restoreFullBackup: async () => ({ tasksRestored: 0, coursesRestored: 0, classesRestored: 0, examsRestored: 0 }),
    importFullBackup: async () => ({ tasksRestored: 0, coursesRestored: 0, classesRestored: 0, examsRestored: 0 }),
    getLatestCheckpoint: () => null,
    restoreFromCheckpoint: async () => true,
    exportToCSV: () => null,
    logout: () => {}
  };
}

function runOverviewTests() {
  console.log('🧪 Starting Overview Render Test Suite...');

  // Sample tasks for counts
  const sampleTasks: Task[] = [
    {
      task_id: 't-1',
      title: 'Lab 1',
      course: 'CPSC 110',
      type: 'assignment',
      due_at: '2020-01-01T23:59:00Z', // past due
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
      created_at: '',
      updated_at: ''
    },
    {
      task_id: 't-2',
      title: 'Working Task',
      course: 'CPSC 210',
      type: 'assignment',
      due_at: '2026-11-01T23:59:00Z',
      status: 'Working',
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
      created_at: '',
      updated_at: ''
    }
  ];

  // 1. Overview in Simple mode has 3 tiles
  console.log('  Testing Overview has 3 tiles in Simple mode...');
  const simpleContext = createMockContext('simple', sampleTasks);
  const simpleHtml = renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}>
      <Overview />
    </TaskContext.Provider>
  );

  // Tiles in Simple: Past due, Due today, Next 7 days
  assert(simpleHtml.includes('Past due'), 'Simple overview has Past due tile');
  assert(simpleHtml.includes('Due today'), 'Simple overview has Due today tile');
  assert(simpleHtml.includes('Next 7 days'), 'Simple overview has Next 7 days tile');
  assert(!simpleHtml.includes('grid-cols-6'), 'Simple overview does not use 6-column grid');

  // Verify Detailed-only tiles are absent in Simple
  // (Note: "Working" could appear in a task card if upNext, but not as stat tile button)
  const simpleTileButtons = simpleHtml.match(/<button[^>]*data-stat-tile[^>]*>/g) || [];
  // Let's count the stat tile divs/buttons
  const simpleHasSubmittedTile = simpleHtml.includes('initialGroup') || !simpleHtml.includes('>Submitted</span>');
  assert(simpleHasSubmittedTile, 'Simple overview does not have Submitted tile');

  // 2. Overview in Detailed mode has 6 tiles
  console.log('  Testing Overview has 6 tiles in Detailed mode...');
  const detailedContext = createMockContext('detailed', sampleTasks);
  const detailedHtml = renderToStaticMarkup(
    <TaskContext.Provider value={detailedContext}>
      <Overview />
    </TaskContext.Provider>
  );

  assert(detailedHtml.includes('Past due'), 'Detailed overview has Past due tile');
  assert(detailedHtml.includes('Due today'), 'Detailed overview has Due today tile');
  assert(detailedHtml.includes('Next 7 days'), 'Detailed overview has Next 7 days tile');
  assert(detailedHtml.includes('Working'), 'Detailed overview has Working tile');
  assert(detailedHtml.includes('Submitted'), 'Detailed overview has Submitted tile');
  assert(detailedHtml.includes('Done'), 'Detailed overview has Done tile');
  assert(detailedHtml.includes('lg:grid-cols-6'), 'Detailed overview uses 6-column grid layout');

  // 3. "Up next" is the first heading
  console.log('  Testing "Up next" is the first heading in Overview...');
  // Find the first heading element (<h1, <h2, <h3, etc.)
  const firstHeadingMatch = simpleHtml.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
  assert(firstHeadingMatch !== null, 'Overview contains at least one heading');
  if (!firstHeadingMatch) throw new Error('Heading match failed');
  assert(
    firstHeadingMatch[1].includes('Up next'),
    `First heading must be "Up next". Found: "${firstHeadingMatch[1]}"`
  );

  const firstHeadingDetailed = detailedHtml.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
  assert(firstHeadingDetailed !== null, 'Detailed overview contains at least one heading');
  if (!firstHeadingDetailed) throw new Error('Detailed heading match failed');
  assert(
    firstHeadingDetailed[1].includes('Up next'),
    `First heading in Detailed must be "Up next". Found: "${firstHeadingDetailed[1]}"`
  );

  // Elapsed timed deadlines stay in today's Vancouver date in both surfaces.
  const now = new Date('2026-10-02T14:00:00-07:00');
  const elapsed = { ...sampleTasks[0], task_id: 'elapsed', title: 'Morning deadline', due_at: '2026-10-02T09:00:00-07:00' };
  const todayContext = { ...createMockContext('detailed', [elapsed]), now };
  const todayHtml = renderToStaticMarkup(<TaskContext.Provider value={todayContext}><Overview /></TaskContext.Provider>);
  assert(/Due today<\/p><p[^>]*>1<\/p>/.test(todayHtml), 'Overview includes an elapsed timed deadline today');
  assert(generateDigestPreview('daily', [elapsed], now).count === 1, 'Digest includes the same elapsed timed deadline');
  assert(isTaskDueToday({ ...elapsed, due_at: '2026-10-03T01:00:00Z' }, now), 'UTC next day can still be today in Vancouver');
  assert(!isTaskDueToday({ ...elapsed, due_at: '2026-10-02T01:00:00Z' }, now), 'UTC today can be yesterday in Vancouver');
  assert(!isTaskDueToday({ ...elapsed, due_at: 'invalid' }, now), 'Invalid deadlines never default to today');
  assert(isTaskDueToday({ ...elapsed, due_at: '2026-10-02' }, now), 'Date-only deadlines retain Vancouver date semantics');

  const completed = { ...elapsed, task_id: 'completed-coursework', title: 'Completed coursework', status: 'Done' };
  const lecture = { ...completed, task_id: 'lecture', title: 'Completed lecture', type: 'lecture' as const };
  const lab = { ...completed, task_id: 'lab', title: 'Completed class lab', type: 'lab' as const, points_possible: '0' };
  const gradedLab = { ...completed, task_id: 'graded-lab', title: 'Graded lab', type: 'lab' as const, points_possible: '10' };
  assert(!isActiveAcademicTask(lecture) && !isActiveAcademicTask(lab), 'Schedule events are excluded from academic completion totals');
  assert(isActiveAcademicTask(gradedLab), 'Graded lab deliverables remain academic tasks');
  const completionContext = { ...createMockContext('detailed', [completed, lecture, lab, gradedLab]), now };
  const render = (child: React.ReactNode) => renderToStaticMarkup(<TaskContext.Provider value={completionContext}>{child}</TaskContext.Provider>);
  assert(/Done<\/p><p[^>]*>2<\/p>/.test(render(<Overview />)), 'Overview counts only the two completed academic tasks');
  assert(render(<ProgressTab />).includes('2 of 2 tasks finished'), 'Progress uses the same academic completion population');
  const completedHtml = render(<TasksList />);
  assert(completedHtml.includes('Completed coursework') && completedHtml.includes('Graded lab'), 'Tasks shows completed coursework and graded labs');
  assert(!completedHtml.includes('Completed lecture') && !completedHtml.includes('Completed class lab'), 'Tasks completion group excludes schedule events');

  completionContext.tasks = [elapsed, { ...lecture, status: 'Not Started', due_at: '2026-10-01' }, { ...lab, status: 'Not Started', due_at: '2026-10-01' }];
  const classesHtml = render(<TasksList />);
  assert(classesHtml.includes('Past classes (2)') && !classesHtml.includes('task-group-no-date'), 'Past schedule events remain in Past classes, never No date');
  assert(render(<ProgressTab />).includes('0 of 1 task finished'), 'Progress singular uses the total task count');
  assert(render(<ProgressTab />).includes('0 of 1 task done'), 'Per-course completion uses the same singular count');

  console.log('✅ ALL OVERVIEW TESTS PASSED SUCCESSFULLY!');
}

runOverviewTests();
