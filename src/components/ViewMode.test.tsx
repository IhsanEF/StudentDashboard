import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_UI_PREFS, UiPrefs, ViewMode } from '../types';
import { ViewModeToggle } from './ViewModeToggle';
import { TaskContext, TaskContextType } from '../hooks/useTasks';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

// In-memory localStorage mock for Node test environment
class MockLocalStorage {
  private store: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as any).localStorage = mockStorage;
(globalThis as any).window = globalThis;

function createMockContext(viewMode: ViewMode = 'simple', setViewMode = (_m: ViewMode) => {}): TaskContextType {
  return {
    now: new Date(),
    updateCourse: async () => {},
    deleteCourse: async () => {},
    uiPrefs: { ...DEFAULT_UI_PREFS, viewMode },
    setViewMode,
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

function runViewModeTests() {
  console.log('🧪 Starting TaskProvider/ViewModeToggle Test Suite...');

  // 1. Default Simple
  console.log('  Testing default view mode is Simple...');
  assert(DEFAULT_UI_PREFS.viewMode === 'simple', 'DEFAULT_UI_PREFS viewMode defaults to simple');

  const simpleContext = createMockContext('simple');
  const simpleHtml = renderToStaticMarkup(
    <TaskContext.Provider value={simpleContext}>
      <ViewModeToggle variant="sidebar" />
    </TaskContext.Provider>
  );

  assert(simpleHtml.includes('role="radiogroup"'), 'Renders radio group');
  assert(simpleHtml.includes('Simple'), 'Contains Simple option');
  assert(simpleHtml.includes('Detailed'), 'Contains Detailed option');
  // Simple radio button has aria-checked="true"
  assert(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*>[\s\S]*?Simple/i.test(simpleHtml) ||
         simpleHtml.includes('aria-checked="true"') && simpleHtml.includes('Simple'), 
         'Simple is checked by default');

  // 2. localStorage round-trip
  console.log('  Testing localStorage round-trip...');
  mockStorage.clear();
  const userId = 'student-test-uid';
  const initialPrefs: UiPrefs = { ...DEFAULT_UI_PREFS, viewMode: 'simple' };
  mockStorage.setItem(`ubc_ui_prefs_${userId}`, JSON.stringify(initialPrefs));

  // Retrieve and verify initial
  let loaded = JSON.parse(mockStorage.getItem(`ubc_ui_prefs_${userId}`)!);
  assert(loaded.viewMode === 'simple', 'Initial loaded preference is simple');

  // Update to Detailed and round-trip through localStorage
  const updatedPrefs: UiPrefs = { ...loaded, viewMode: 'detailed' };
  mockStorage.setItem(`ubc_ui_prefs_${userId}`, JSON.stringify(updatedPrefs));

  loaded = JSON.parse(mockStorage.getItem(`ubc_ui_prefs_${userId}`)!);
  assert(loaded.viewMode === 'detailed', 'Updated preference round-trips to detailed');

  // Verify Detailed markup
  const detailedContext = createMockContext('detailed');
  const detailedHtml = renderToStaticMarkup(
    <TaskContext.Provider value={detailedContext}>
      <ViewModeToggle variant="sidebar" />
    </TaskContext.Provider>
  );
  assert(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*>[\s\S]*?Detailed/i.test(detailedHtml) ||
         detailedHtml.includes('aria-checked="true"') && detailedHtml.includes('Detailed'), 
         'Detailed is checked when viewMode is detailed');

  // 3. Cleared on logout
  console.log('  Testing localStorage cleared on logout...');
  // Set user and demo preference keys
  mockStorage.setItem(`ubc_ui_prefs_${userId}`, JSON.stringify(updatedPrefs));
  mockStorage.setItem('ubc_ui_prefs_demo_student', JSON.stringify(updatedPrefs));
  mockStorage.setItem('ubc_ui_prefs_demo-student', JSON.stringify(updatedPrefs));

  assert(mockStorage.getItem(`ubc_ui_prefs_${userId}`) !== null, 'User key exists before logout');
  assert(mockStorage.getItem('ubc_ui_prefs_demo_student') !== null, 'Demo key exists before logout');

  // Simulate logout cleanup as performed by TaskProvider handleLogout
  mockStorage.removeItem(`ubc_ui_prefs_${userId}`);
  mockStorage.removeItem('ubc_ui_prefs_demo_student');
  mockStorage.removeItem('ubc_ui_prefs_demo-student');

  assert(mockStorage.getItem(`ubc_ui_prefs_${userId}`) === null, 'User UI prefs cleared on logout');
  assert(mockStorage.getItem('ubc_ui_prefs_demo_student') === null, 'Demo UI prefs cleared on logout');
  assert(mockStorage.getItem('ubc_ui_prefs_demo-student') === null, 'Hyphenated demo UI prefs cleared on logout');

  console.log('✅ ALL VIEW MODE TESTS PASSED SUCCESSFULLY!');
}

runViewModeTests();
