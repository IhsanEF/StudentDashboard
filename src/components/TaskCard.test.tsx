import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Task, DEFAULT_UI_PREFS } from '../types';
import TaskCard from './TaskCard';
import AddTaskModal from './AddTaskModal';
import QuickAddModal from './QuickAddModal';
import { getCardMenuItems } from './CardMenu';
import { TaskContext, TaskContextType } from '../hooks/useTasks';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

function createMockContext(isSimple: boolean = true): TaskContextType {
  return {
    now: new Date(),
    updateCourse: async () => {},
    deleteCourse: async () => {},
    uiPrefs: { ...DEFAULT_UI_PREFS, viewMode: isSimple ? 'simple' : 'detailed' },
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
    tasks: [],
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

function createBaseTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'test-card-1',
    title: 'Assignment 1: Algorithms',
    course: 'CPSC 320',
    type: 'assignment',
    due_at: '2026-10-20T23:59:00Z',
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
    summary: 'Analyze asymptotic runtime',
    source_message_id: '',
    last_email_at: '',
    needs_review: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides
  };
}

function runTaskCardTests() {
  console.log('🧪 Starting TaskCard Render Test Suite...');

  // 1. A pending card in Simple has 5 controls: 4 segmented status options + CardMenu
  console.log('  Testing pending card in Simple view has 5 controls (4 segmented status buttons + CardMenu)...');
  const pendingTask = createBaseTask({ status: 'Not Started' });
  const simpleContext = createMockContext(true);

  const pendingHtml = renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}>
      <TaskCard task={pendingTask} />
    </TaskContext.Provider>
  );

  // Count interactive buttons in the card
  const buttonMatches = pendingHtml.match(/<button[\s>]/g) || [];
  assert(
    buttonMatches.length === 5,
    `Pending card in Simple mode must have 5 controls (To-do, Working, Submitted, Done, CardMenu trigger). Found: ${buttonMatches.length}`
  );
  assert(pendingHtml.includes('To-do'), 'Card has To-do action button');
  assert(pendingHtml.includes('Working'), 'Card has Working action button');
  assert(pendingHtml.includes('Submitted'), 'Card has Submitted action button');
  assert(pendingHtml.includes('Done'), 'Card has Done action button');
  assert(pendingHtml.includes('aria-haspopup="menu"'), 'Card has CardMenu trigger button');

  // 2. A Done card's menu has only Edit and Delete
  console.log("  Testing Done card's menu has only Edit and Delete...");
  const doneTask = createBaseTask({ status: 'Done' });
  const doneMenuItems = getCardMenuItems(doneTask, {
    onEdit: () => {},
    onMarkSubmitted: () => {},
    onHideUntilTomorrow: () => {},
    onAddNote: () => {},
    onBreakIntoSteps: () => {},
    onDeleteClick: () => {}
  });

  assert(doneMenuItems.length === 2, `Done card menu must have exactly 2 items. Found: ${doneMenuItems.length}`);
  assert(doneMenuItems[0].label === 'Edit' && doneMenuItems[0].key === 'edit', 'First item is Edit');
  assert(doneMenuItems[1].label === 'Delete' && doneMenuItems[1].key === 'delete', 'Second item is Delete');

  // Also check Submitted task has only Edit and Delete
  const submittedTask = createBaseTask({ status: 'Submitted' });
  const submittedMenuItems = getCardMenuItems(submittedTask, {
    onEdit: () => {},
    onDeleteClick: () => {}
  });
  assert(submittedMenuItems.length === 2, 'Submitted card menu also has only Edit and Delete');

  // 3. A quiz card has no Break into steps
  console.log('  Testing quiz card has no Break into steps...');
  const quizTask = createBaseTask({ type: 'quiz', status: 'Not Started' });
  const quizMenuItems = getCardMenuItems(quizTask, {
    onEdit: () => {},
    onMarkSubmitted: () => {},
    onHideUntilTomorrow: () => {},
    onAddNote: () => {},
    onBreakIntoSteps: () => {},
    onDeleteClick: () => {}
  });

  const quizHasSteps = quizMenuItems.some(item => item.key === 'steps' || item.label.includes('steps') || item.label.includes('Steps'));
  assert(!quizHasSteps, 'Quiz card menu must NOT contain Break into steps');

  // Contrast with standard assignment which does have Break into steps
  const assignmentTask = createBaseTask({ type: 'assignment', status: 'Not Started' });
  const assignmentMenuItems = getCardMenuItems(assignmentTask, {
    onEdit: () => {},
    onMarkSubmitted: () => {},
    onHideUntilTomorrow: () => {},
    onAddNote: () => {},
    onBreakIntoSteps: () => {},
    onDeleteClick: () => {}
  });
  const assignmentHasSteps = assignmentMenuItems.some(item => item.key === 'steps');
  assert(assignmentHasSteps, 'Assignment card menu includes Break into steps');

  const notesHtml = renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}>
      <TaskCard task={createBaseTask({ progress_notes: '[2026-09-04T15:10:21-07:00] started reading' })} />
    </TaskContext.Provider>
  );
  assert(notesHtml.includes('Sep 4, 3:10 PM — started reading'), 'Card notes use Vancouver readable timestamps');
  assert(!notesHtml.includes('2026-09-04T15:10:21'), 'Card does not expose raw ISO note timestamps');
  const utcNotesHtml = renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}>
      <TaskCard task={createBaseTask({ progress_notes: '[2026-09-04T22:10:21Z] started reading' })} />
    </TaskContext.Provider>
  );
  assert(utcNotesHtml.includes('Sep 4, 3:10 PM'), 'UTC timestamps display in Vancouver');
  const plainNotesHtml = renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}>
      <TaskCard task={createBaseTask({ progress_notes: 'untimestamped legacy note' })} />
    </TaskContext.Provider>
  );
  assert(plainNotesHtml.includes('untimestamped legacy note'), 'Legacy note content is preserved');

  for (const Modal of [AddTaskModal, QuickAddModal]) {
    const html = renderToStaticMarkup(<TaskContext.Provider value={simpleContext}><Modal isOpen onClose={() => {}} /></TaskContext.Provider>);
    assert(html.includes('role="dialog"') && html.includes('aria-modal="true"'), 'Both task composers render an accessible modal');
    assert(html.includes('type="datetime-local"'), 'Both previews allow editing the due time');
  }

  const renderCard = (overrides: Partial<Task>) => renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}><TaskCard task={createBaseTask(overrides)} /></TaskContext.Provider>
  );
  for (const url of ['https://canvas.ubc.ca.evil.example/login', 'https://evilubc.ca/login', 'https://canvas.ubc.ca@evil.example/login', 'https://instructure.com.evil.example/login']) {
    const html = renderCard({ canvas_url: url });
    assert(html.includes('External · '), `Untrusted destination is visibly labelled: ${url}`);
    assert(html.includes('title="External: '), 'Title link tooltip identifies external hostname');
    assert(html.includes('rel="noopener noreferrer"'), 'External links isolate their opener');
  }
  for (const url of ['https://canvas.ubc.ca/courses/1', 'https://learn.ubc.ca/courses/1', 'https://ubc.instructure.com/courses/1']) {
    assert(renderCard({canvas_url: url}).includes('External · '), 'Institution domains are ordinary external links');
  }
  assert(!renderCard({canvas_url:'javascript:alert(1)'}).includes('href="javascript:'), 'Unsafe schemes remain blocked');
  simpleContext.now = new Date('2026-10-02T19:00:00Z');
  assert(renderCard({due_at:'2026-10-02T11:55:00-07:00'}).includes('Overdue by 5 minutes'), 'Earlier-today deadline explains overdue state');
  assert(renderCard({due_at:'2026-10-02T16:42:00-07:00'}).includes('Due today, 4:42 PM'), 'Today deadline explains local time');
  assert(!renderCard({due_at:'2026-10-02T11:55:00-07:00',status:'Done'}).includes('Overdue by'), 'Completed tasks have no overdue hint');
  assert(renderCard({source_message_id:'message-123'}).includes('Source message: message-123'), 'Source ID is read for provenance');

  console.log('✅ ALL TASK CARD TESTS PASSED SUCCESSFULLY!');
}

runTaskCardTests();
