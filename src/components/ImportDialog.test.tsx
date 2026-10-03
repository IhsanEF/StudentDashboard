import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_UI_PREFS } from '../types';
import SmartImportModal from './SmartImportModal';
import { TaskContext, TaskContextType } from '../hooks/useTasks';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

function createMockContext(): TaskContextType {
  return {
    now: new Date(),
    updateCourse: async () => {},
    deleteCourse: async () => {},
    uiPrefs: DEFAULT_UI_PREFS,
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

function runImportDialogTests() {
  console.log('🧪 Starting Import Dialog DOM Test Suite...');

  const mockCtx = createMockContext();

  // 1. When closed, exactly 0 dialog elements exist
  console.log('  Testing 0 dialogs when closed...');
  const closedHtml = renderToStaticMarkup(
    <TaskContext.Provider value={mockCtx}>
      <SmartImportModal isOpen={false} onClose={() => {}} />
    </TaskContext.Provider>
  );
  const closedDialogMatches = closedHtml.match(/role=["']dialog["']/g) || [];
  assert(closedDialogMatches.length === 0, `Expected 0 dialogs when closed, found ${closedDialogMatches.length}`);
  assert(closedHtml === '', 'Closed modal renders empty markup');

  // 2. When open, exactly ONE role="dialog" element exists
  console.log('  Testing exactly ONE role="dialog" element when open...');
  const openHtml = renderToStaticMarkup(
    <TaskContext.Provider value={mockCtx}>
      <SmartImportModal isOpen={true} onClose={() => {}} />
    </TaskContext.Provider>
  );

  const openDialogMatches = openHtml.match(/role=["']dialog["']/g) || [];
  assert(
    openDialogMatches.length === 1,
    `Expected exactly one role="dialog" when open, found ${openDialogMatches.length}`
  );

  // 3. Verify dialog accessibility attributes and structure
  console.log('  Testing dialog accessibility attributes...');
  assert(openHtml.includes('aria-modal="true"'), 'Dialog has aria-modal="true"');
  assert(openHtml.includes('aria-labelledby="smart-import-title"'), 'Dialog has aria-labelledby="smart-import-title"');
  assert(openHtml.includes('id="smart-import-title"'), 'Heading has matching id');
  assert(openHtml.includes('Import coursework'), 'Dialog contains Import coursework title');

  console.log('✅ ALL IMPORT DIALOG DOM TESTS PASSED SUCCESSFULLY!');
}

runImportDialogTests();
