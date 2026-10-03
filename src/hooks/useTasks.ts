import { createContext, useContext } from 'react';
import { 
  Task, 
  Course, 
  NotificationPrefs, 
  InAppNotification, 
  ClassScheduleItem, 
  ExamItem, 
  DashboardBackupSnapshot, 
  DashboardBackup,
  GroupProject,
  GroupTask,
  ActiveFocusState,
  FocusTimerMode,
  UiPrefs,
  ViewMode
} from '../types';

export interface ToastItem {
  id: string;
  message: string;
  undo?: () => void;
}

export type ImportTabType = 'calendar' | 'email' | 'file' | 'screenshot' | 'syllabus';

export interface TaskContextType {
  uiPrefs: UiPrefs;
  setViewMode: (mode: ViewMode) => void;
  updateUiPrefs: (partial: Partial<UiPrefs>) => void;
  focusModeActive: boolean;
  isFocusModeActive: boolean;
  setFocusModeActive: (active: boolean) => void;
  // Import modal
  openImport: (tab?: ImportTabType) => void;
  isImportOpen: boolean;
  importInitialTab: ImportTabType;
  closeImport: () => void;
  // Toast notifications
  toast: ToastItem | null;
  showToast: (options: { message: string; undo?: () => void }) => void;
  dismissToast: () => void;
  now: Date;
  tasks: Task[];
  courses: Course[];
  updateCourse: (course: Course) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  classes: ClassScheduleItem[];
  exams: ExamItem[];
  groups: GroupProject[];
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  groupTasks: GroupTask[];
  loading: boolean;
  error: string | null;
  lastSync: Date | null;
  isOnline: boolean;
  hasPendingWrites: boolean;
  isDemoMode: boolean;
  notificationPrefs: NotificationPrefs;
  notifications: InAppNotification[];
  unreadNotificationCount: number;
  updateNotificationPrefs: (prefs: NotificationPrefs) => Promise<void>;
  markNotificationAsRead: (notificationId: string) => void;
  markAllNotificationsAsRead: () => void;
  clearNotification: (notificationId: string) => void;
  clearAllNotifications: () => void;
  triggerTestReminder: (leadMinutes?: number) => void;
  triggerDigest: (type: 'daily' | 'weekly') => void;
  clearReminderHistory: () => void;
  enableDemoMode: () => void;
  disableDemoMode: () => void;
  refreshTasks: () => Promise<void>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  addTask: (task: Task) => Promise<void>;
  batchAddTasks: (tasks: Task[]) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  dismissReviewTasks?: (taskIds?: string[]) => Promise<void>;
  // Class Schedule operations
  addClassItem: (item: ClassScheduleItem) => Promise<void>;
  updateClassItem: (id: string, updates: Partial<ClassScheduleItem>) => Promise<void>;
  deleteClassItem: (id: string) => Promise<void>;
  // Exam operations
  addExamItem: (item: ExamItem) => Promise<void>;
  updateExamItem: (id: string, updates: Partial<ExamItem>) => Promise<void>;
  deleteExamItem: (id: string) => Promise<void>;
  // Focus Timer operations
  activeFocus: ActiveFocusState | null;
  startFocusTimer: (task: { id: string; title: string; course: string }, durationMinutes?: number, mode?: FocusTimerMode) => void;
  pauseFocusTimer: () => void;
  resumeFocusTimer: () => void;
  resetFocusTimer: () => void;
  stopAndLogFocusTimer: (minutesToLog?: number) => Promise<void>;
  logManualFocusTime: (taskId: string, minutes: number, mode?: FocusTimerMode, notes?: string) => Promise<void>;
  // Group Workspace operations
  createGroup: (data: { name: string; course_code: string; description?: string; target_date?: string }) => Promise<GroupProject>;
  joinGroupByCode: (code: string) => Promise<GroupProject | null>;
  leaveGroup: (groupId: string) => Promise<void>;
  saveGroupTaskAction: (groupId: string, task: Partial<GroupTask> & { title: string }) => Promise<string>;
  deleteGroupTaskAction: (groupId: string, taskId: string) => Promise<void>;
  // Data protection and backup
  exportFullBackup: () => Promise<DashboardBackupSnapshot>;
  downloadFullBackup: () => Promise<{ fileName: string }>;
  restoreFullBackup: (snapshot: DashboardBackupSnapshot, mode?: 'merge' | 'replace') => Promise<{ tasksRestored: number; coursesRestored: number; classesRestored: number; examsRestored: number }>;
  importFullBackup: (backup: DashboardBackup, mode?: 'merge' | 'replace') => Promise<{ tasksRestored: number; coursesRestored: number; classesRestored: number; examsRestored: number }>;
  getLatestCheckpoint: () => any;
  restoreFromCheckpoint: () => Promise<boolean>;
  exportToCSV: () => { fileName: string; taskCount: number } | null;
  logout: () => void;
}



export const TaskContext = createContext<TaskContextType | undefined>(undefined);

export function useTasksContext() {
  const context = useContext(TaskContext);
  if (!context) throw new Error('useTasksContext must be used within TaskProvider');
  return context;
}
