import { reportError } from './services/errorReporter';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FieldValue } from 'firebase/firestore';
import { TaskContext, TaskContextType, ToastItem, ImportTabType } from './hooks/useTasks';
import { FocusClockProvider } from './hooks/useFocusTimer';
import {
  Task,
  Course,
  AppUser,
  NotificationPrefs,
  InAppNotification,
  DEFAULT_NOTIFICATION_PREFS,
  ClassScheduleItem,
  ExamItem,
  DashboardBackupSnapshot,
  GroupProject,
  GroupTask,
  ActiveFocusState,
  FocusTimerMode,
  FocusSession,
  UiPrefs,
  DEFAULT_UI_PREFS,
  ViewMode
} from './types';
import { DEMO_TASKS, DEMO_CLASSES, DEMO_EXAMS, DEMO_GROUPS, DEMO_GROUP_TASKS, getDemoTasks, getDemoTerm, getDemoExams } from './demoData';
import { logout as firebaseLogout, googleSignIn } from './auth';
import { useModalFocus } from './hooks/useModalFocus';
import { formatInTimeZone, TIMEZONE, normalizeCourseCode, isTaskAnnouncement } from './utils';
import { addDays } from 'date-fns';
import { AlertTriangle } from 'lucide-react';

/**
 * Validates a Canvas Calendar Feed URL for security and correctness.
 * Must be HTTPS, hosted on canvas.ubc.ca or instructure.com (or canvas domain),
 * and have a path ending with .ics or contain /feeds/calendars/ .
 */
export function validateCanvasFeedUrl(urlStr?: string): { valid: boolean; error?: string } {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'Feed URL is empty' };
  }
  const trimmed = urlStr.trim();
  if (!trimmed) {
    return { valid: false, error: 'Feed URL is empty' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Canvas calendar feed URL must use HTTPS (https://...)' };
    }
    const host = parsed.hostname.toLowerCase();
    const isCanvasHost =
      host === 'canvas.ubc.ca' ||
      host.endsWith('.instructure.com') ||
      host.includes('canvas.');
    if (!isCanvasHost) {
      return { valid: false, error: 'Feed URL must be from Canvas (e.g. canvas.ubc.ca or *.instructure.com)' };
    }
    const path = parsed.pathname.toLowerCase();
    const hasIcs = path.endsWith('.ics') || parsed.pathname.toLowerCase().includes('/feeds/calendars/');
    if (!hasIcs) {
      return {
        valid: false,
        error: 'Paste the Canvas "Calendar Feed" link (.ics), not the Canvas calendar web page. Find it at Canvas > Calendar > Calendar Feed.'
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid calendar URL format' };
  }
}

/**
 * Validates the parsed shape and calculates elapsed time based on wall-clock time
 * when restoring activeFocus from localStorage or cross-tab sync events.
 * Namespaces and validates userId to ensure state is discarded on mismatch.
 */
export function parseValidFocusTimer(raw: any, expectedUserId?: string): ActiveFocusState | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;

    // Discard saved timer if it explicitly belongs to another user
    if (expectedUserId && parsed.userId && parsed.userId !== expectedUserId) {
      return null;
    }

    // Validate essential properties
    if (typeof parsed.taskId !== 'string' || !parsed.taskId) return null;
    if (typeof parsed.durationSeconds !== 'number' || isNaN(parsed.durationSeconds) || parsed.durationSeconds <= 0) return null;
    if (typeof parsed.taskTitle !== 'string') return null;

    const validModes: FocusTimerMode[] = ['pomodoro', 'short_break', 'long_break', 'deep_work', 'custom'];
    const mode: FocusTimerMode = validModes.includes(parsed.mode) ? parsed.mode : 'pomodoro';

    let isRunning = Boolean(parsed.isRunning);
    let isCompleted = Boolean(parsed.completed);
    let calculatedSecondsLeft = typeof parsed.pausedRemaining === 'number' ? parsed.pausedRemaining : parsed.durationSeconds;

    // Derive accurate remaining seconds from wall-clock time if timer was running
    if (isRunning && typeof parsed.endsAt === 'number') {
      const remaining = Math.round((parsed.endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        calculatedSecondsLeft = 0;
        isCompleted = true;
        isRunning = false;
      } else {
        calculatedSecondsLeft = remaining;
      }
    } else if (!isRunning && typeof parsed.pausedRemaining === 'number') {
      calculatedSecondsLeft = Math.max(0, Math.min(parsed.durationSeconds, parsed.pausedRemaining));
    } else if (typeof parsed.secondsLeft === 'number' && !isNaN(parsed.secondsLeft)) {
      calculatedSecondsLeft = Math.max(0, Math.min(parsed.durationSeconds, parsed.secondsLeft));
    }

    return {
      userId: parsed.userId || expectedUserId || undefined,
      taskId: parsed.taskId,
      taskTitle: parsed.taskTitle || 'Task',
      courseCode: typeof parsed.courseCode === 'string' ? parsed.courseCode : '',
      durationSeconds: parsed.durationSeconds,
      secondsLeft: Math.max(0, calculatedSecondsLeft),
      isRunning: isCompleted ? false : isRunning,
      mode,
      sessionCount: typeof parsed.sessionCount === 'number' ? parsed.sessionCount : 0,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
      ...(isCompleted ? {} : typeof parsed.endsAt === 'number' ? { endsAt: parsed.endsAt }
        : isRunning ? { endsAt: Date.now() + Math.max(0, calculatedSecondsLeft) * 1000 } : {}),
      pausedAt: typeof parsed.pausedAt === 'number' ? parsed.pausedAt : undefined,
      pausedRemaining: typeof parsed.pausedRemaining === 'number' ? parsed.pausedRemaining : undefined,
      loggedSeconds: typeof parsed.loggedSeconds === 'number' ? parsed.loggedSeconds : 0,
      completed: isCompleted,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : `session_${Date.now()}`
    };
  } catch {
    return null;
  }
}

/**
 * V4-112: Restricts Sample assignments to a date window (past 30 days .. +1 year),
 * caps the total evaluated events (e.g. 500), and caps new imported items per sync (e.g. 100).
 */
export function filterAndCapCanvasEvents(
  tasks: Task[],
  referenceDate: Date = new Date(),
  maxNewItems: number = 100,
  maxTotalEvents: number = 500
): { tasksToImport: Task[]; unimportedCount: number; droppedOutOfWindow: number } {
  const refTime = referenceDate.getTime();
  const past30Days = refTime - (30 * 24 * 60 * 60 * 1000);
  const future1Year = refTime + (365 * 24 * 60 * 60 * 1000);

  let droppedOutOfWindow = 0;
  const inWindowTasks: Task[] = [];

  for (const t of tasks) {
    if (t.due_at) {
      const dt = new Date(t.due_at).getTime();
      if (!isNaN(dt)) {
        if (dt < past30Days || dt > future1Year) {
          droppedOutOfWindow++;
          continue;
        }
      }
    }
    inWindowTasks.push(t);
    if (inWindowTasks.length >= maxTotalEvents) {
      break;
    }
  }

  const tasksToImport = inWindowTasks.slice(0, maxNewItems);
  const unimportedCount = Math.max(0, inWindowTasks.length - tasksToImport.length);

  return {
    tasksToImport,
    unimportedCount,
    droppedOutOfWindow
  };
}

/**
 * Strips bearer secrets (Canvas calendar feed URL containing personal tokens) and personal
 * email / sync timestamps from exported backup files to prevent sensitive data leakage.
 */
export function sanitizeNotificationPrefsForExport(prefs?: NotificationPrefs): NotificationPrefs | undefined {
  if (!prefs) return undefined;
  const sanitized: NotificationPrefs = { ...prefs };
  delete sanitized.savedCalendarFeedUrl;
  delete sanitized.customEmail;
  delete sanitized.lastCalendarSync;
  delete sanitized.lastCalendarAttempt;
  delete sanitized.lastCalendarSyncError;
  delete sanitized.lastDailyDigestDate;
  delete sanitized.lastWeeklyDigestDate;
  delete sanitized.dismissedCanvasIds;
  return sanitized;
}

/**
 * Strips and ignores external calendar feed URLs, auto-sync flags, and custom emails from
 * imported backup files. Preserves existing local student credentials and only restores reminder settings.
 */
export function sanitizeNotificationPrefsForImport(
  importedPrefs?: any,
  existingPrefs?: NotificationPrefs
): NotificationPrefs | undefined {
  if (!importedPrefs || typeof importedPrefs !== 'object') return existingPrefs;
  const base = {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...existingPrefs,
    channels: { ...DEFAULT_NOTIFICATION_PREFS.channels, ...existingPrefs?.channels },
    quietHours: { ...DEFAULT_NOTIFICATION_PREFS.quietHours, ...existingPrefs?.quietHours },
    digests: { ...DEFAULT_NOTIFICATION_PREFS.digests, ...existingPrefs?.digests }
  };

  return cleanForFirestore({
    ...base,
    enabled: typeof importedPrefs.enabled === 'boolean' ? importedPrefs.enabled : base.enabled,
    channels: importedPrefs.channels && typeof importedPrefs.channels === 'object' ? {
      inApp: typeof importedPrefs.channels.inApp === 'boolean' ? importedPrefs.channels.inApp : base.channels.inApp,
      email: typeof importedPrefs.channels.email === 'boolean' ? importedPrefs.channels.email : base.channels.email,
      push: typeof importedPrefs.channels.push === 'boolean' ? importedPrefs.channels.push : base.channels.push,
    } : base.channels,
    leadTimes: Array.isArray(importedPrefs.leadTimes)
      ? importedPrefs.leadTimes.filter((n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      : base.leadTimes,
    quietHours: importedPrefs.quietHours && typeof importedPrefs.quietHours === 'object' ? {
      enabled: typeof importedPrefs.quietHours.enabled === 'boolean' ? importedPrefs.quietHours.enabled : base.quietHours.enabled,
      start: typeof importedPrefs.quietHours.start === 'string' ? importedPrefs.quietHours.start : base.quietHours.start,
      end: typeof importedPrefs.quietHours.end === 'string' ? importedPrefs.quietHours.end : base.quietHours.end,
    } : base.quietHours,
    maxPerDay: typeof importedPrefs.maxPerDay === 'number' && Number.isFinite(importedPrefs.maxPerDay) && importedPrefs.maxPerDay >= 0 ? importedPrefs.maxPerDay : base.maxPerDay,
    digests: importedPrefs.digests && typeof importedPrefs.digests === 'object' ? {
      dailyMorning: typeof importedPrefs.digests.dailyMorning === 'boolean' ? importedPrefs.digests.dailyMorning : base.digests.dailyMorning,
      weeklySunday: typeof importedPrefs.digests.weeklySunday === 'boolean' ? importedPrefs.digests.weeklySunday : base.digests.weeklySunday,
    } : base.digests,
    workloadThresholdHours: typeof importedPrefs.workloadThresholdHours === 'number' && !isNaN(importedPrefs.workloadThresholdHours)
      ? importedPrefs.workloadThresholdHours
      : base.workloadThresholdHours,
    // Explicitly preserve existing local feed credentials and never adopt them from untrusted import files
    savedCalendarFeedUrl: base.savedCalendarFeedUrl,
    autoSyncCalendar: base.autoSyncCalendar,
    customEmail: base.customEmail,
    lastCalendarSync: base.lastCalendarSync,
    lastCalendarAttempt: base.lastCalendarAttempt,
    lastCalendarSyncError: base.lastCalendarSyncError,
    dismissedCanvasIds: base.dismissedCanvasIds
  });
}
import { playFocusCompletionChime } from './utils/audioChime';
import {
  syncUserProfile,
  cleanForFirestore,
  normalizeTask,
  normalizeCourse,
  normalizeClassScheduleItem,
  normalizeExamItem,
  subscribeToTasks,
  fetchUserTasks,
  fetchUserCourses,
  updateFirestoreTask,
  addFirestoreTask,
  batchImportTasksAndCourses,
  deleteFirestoreTask,
  fetchUserNotificationPrefs,
  updateUserNotificationPrefs,
  fetchUserUiPrefs,
  updateUserUiPrefs,
  subscribeToCourses,
  saveFirestoreCourse,
  deleteFirestoreCourse,
  INITIAL_SAMPLE_COURSES,
  subscribeToClassSchedule,
  saveFirestoreClassScheduleItem,
  deleteFirestoreClassScheduleItem,
  subscribeToExams,
  saveFirestoreExamItem,
  deleteFirestoreExamItem,
  createFullDashboardBackup,
  restoreDashboardBackup,
  subscribeToUserGroups,
  subscribeToGroupTasks,
  createFirestoreGroupProject,
  joinFirestoreGroupByCode,
  leaveFirestoreGroup,
  saveFirestoreGroupTask,
  deleteFirestoreGroupTask,
  logFirestoreFocusSession
} from './services/db';
import {
  loadSavedNotifications,
  updateSavedNotifications,
  evaluateNotifications,
  clearFiredHistory,
  showBrowserNotification,
  formatLeadTimeText,
  generateDigestPreview
} from './services/notificationService';
import { auth } from './auth';

export const FICTIONAL_SAMPLE_COURSES: Course[] = INITIAL_SAMPLE_COURSES.map(c => ({
  ...c,
  instructor: c.course_code === 'CPSC 310' ? 'Prof. Alex Taylor (Sample)' :
              c.course_code === 'MATH 200' ? 'Prof. Morgan Lee (Sample)' :
              'Prof. Jordan Smith (Sample)',
  instructor_email: c.course_code === 'CPSC 310' ? 'taylor.sample@example.com' :
                    c.course_code === 'MATH 200' ? 'lee.sample@example.com' :
                    'smith.sample@example.com'
}));

export function mergeById<T>(existing: T[], incoming: T[], getId: (item: T) => string): T[] {
  const merged = new Map(existing.map(item => [getId(item), item]));
  incoming.forEach(item => merged.set(getId(item), item));
  return [...merged.values()];
}

export function normalizeBackupSnapshot(snapshot: DashboardBackupSnapshot): DashboardBackupSnapshot {
  const normalizeItems = <T,>(raw: unknown, kind: string, idKey: string, normalize: (item: any, id: string) => T): T[] => {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error(`Invalid backup: ${kind} must be an array.`);
    const normalized = raw.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`Invalid backup: ${kind} item ${index + 1} must be an object.`);
      }
      const id = typeof item[idKey] === 'string' && item[idKey].trim()
        ? item[idKey] : `backup-${kind}-${index + 1}`;
      // Schedule normalizers assume string fields. Remove malformed field values first.
      const input = kind === 'classes' || kind === 'exams'
        ? Object.fromEntries(Object.entries(item).filter(([key, value]) => typeof value === 'string' || (key === 'weight_percent' && typeof value === 'number')))
        : item;
      return cleanForFirestore(normalize({ ...input, [idKey]: id }, id));
    });
    return mergeById([], normalized, item => (item as any)[idKey]);
  };
  return {
    ...snapshot,
    tasks: normalizeItems(snapshot.tasks, 'tasks', 'task_id', normalizeTask),
    courses: normalizeItems(snapshot.courses, 'courses', 'id', normalizeCourse),
    classes: normalizeItems(snapshot.classes, 'classes', 'id', normalizeClassScheduleItem),
    exams: normalizeItems(snapshot.exams, 'exams', 'id', normalizeExamItem),
    ...(snapshot.uiPrefs ? { uiPrefs: {
      viewMode: snapshot.uiPrefs.viewMode === 'detailed' ? 'detailed' : 'simple',
      moreToolsOpen: snapshot.uiPrefs.moreToolsOpen === true,
      optionalToolsOpen: snapshot.uiPrefs.optionalToolsOpen === true,
      seenViewNotice: snapshot.uiPrefs.seenViewNotice === true
    } } : {})
  };
}

export function TaskProvider({
  children,
  user,
  initialDemoMode = false,
  onLogout,
  onDemoSignIn
}: {
  children: React.ReactNode,
  user: AppUser | null,
  initialDemoMode?: boolean,
  onLogout: () => void,
  onDemoSignIn?: (user: AppUser) => void
}) {
  const [now, setNow] = useState(() => new Date(Date.now()));
  useEffect(() => {
    const refreshNow = () => setNow(new Date(Date.now()));
    const onVisible = () => { if (document.visibilityState === 'visible') refreshNow(); };
    const interval = setInterval(refreshNow, 60000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refreshNow);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refreshNow);
    };
  }, []);
  const demoTasksBaselineRef = useRef(getDemoTasks());
  const demoExamsBaselineRef = useRef(getDemoExams());
  const demoCoursesBaselineRef = useRef(FICTIONAL_SAMPLE_COURSES.map(course => ({ ...course, ...getDemoTerm() })));
  const [tasks, setTasks] = useState<Task[]>(() => initialDemoMode ? demoTasksBaselineRef.current : []);
  const hasLoadedTasksRef = useRef(false);
  const tasksRef = useRef<Task[]>([]);

  // Keep tasksRef in sync with tasks
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [courses, setCourses] = useState<Course[]>(() => initialDemoMode ? demoCoursesBaselineRef.current : []);
  const [classes, setClasses] = useState<ClassScheduleItem[]>(initialDemoMode ? DEMO_CLASSES : []);
  const [exams, setExams] = useState<ExamItem[]>(() => initialDemoMode ? demoExamsBaselineRef.current : []);
  const [groups, setGroups] = useState<GroupProject[]>(initialDemoMode ? DEMO_GROUPS : []);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(initialDemoMode ? 'demo-group-1' : null);
  const [groupTasks, setGroupTasks] = useState<GroupTask[]>(initialDemoMode ? DEMO_GROUP_TASKS : []);

  const initialUserId = initialDemoMode ? 'demo_student' : (user?.uid || 'guest');

  // Focus Timer state (namespaced by uid, resumed from localStorage if matching, never on demo entry)
  const [activeFocus, setActiveFocus] = useState<(ActiveFocusState & { justCompleted?: boolean }) | null>(() => {
    if (typeof window === 'undefined' || initialDemoMode) {
      if (typeof window !== 'undefined' && initialDemoMode) {
        try {
          localStorage.removeItem('ubc_active_focus_timer');
          localStorage.removeItem('ubc_active_focus_timer_demo-student');
          localStorage.removeItem('ubc_active_focus_timer_demo_student');
        } catch {}
      }
      return null;
    }
    const uid = initialUserId;
    const namespacedKey = `ubc_active_focus_timer_${uid}`;
    try {
      const namespaced = localStorage.getItem(namespacedKey);
      const legacy = localStorage.getItem('ubc_active_focus_timer');
      const saved = namespaced || legacy;
      if (!saved) return null;
      // Legacy timers without an owner cannot safely be assigned to this account.
      if (!namespaced && JSON.parse(saved)?.userId !== uid) {
        localStorage.removeItem('ubc_active_focus_timer');
        return null;
      }
      const parsed = parseValidFocusTimer(saved, uid);
      if (!parsed) {
        localStorage.removeItem(namespacedKey);
        localStorage.removeItem('ubc_active_focus_timer');
        return null;
      }
      if (parsed.userId && parsed.userId !== uid) {
        localStorage.removeItem(namespacedKey);
        localStorage.removeItem('ubc_active_focus_timer');
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(!initialDemoMode);
  const [error, setError] = useState<string | null>(null);
  // Listener recovery must never dismiss a rejected write's validation notice.
  const [writeError, setWriteError] = useState<string | null>(null);
  const reportWriteError = (err: any, fallback: string) => {
    reportError(err, { source: 'TaskProvider.task.write' });
    setWriteError(err?.code === 'permission-denied'
      ? 'This change was rejected by validation or account permissions. Check the entered values and try again.'
      : fallback);
  };
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(initialDemoMode);
  const hasSeededDemoRef = useRef<boolean>(initialDemoMode);
  const endingSessionRef = useRef(false);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;
  const checkpointRef = useRef<(DashboardBackupSnapshot & { timestamp?: string }) | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [hasPendingWrites, setHasPendingWrites] = useState<boolean>(false);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const retryCountsRef = useRef<Record<string, number>>({});
  const retryStoppedRef = useRef(false);
  useEffect(() => {
    retryCountsRef.current = {};
    retryStoppedRef.current = false;
  }, [user?.uid, isDemoMode]);

  // Notification state & UI preferences
  const currentUserId = isDemoMode ? 'demo_student' : (user?.uid || 'guest');

  // Discard active focus timer if user account changes
  useEffect(() => {
    if (activeFocus && activeFocus.userId && activeFocus.userId !== currentUserId) {
      setActiveFocus(null);
    }
  }, [currentUserId, activeFocus]);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState<boolean>(initialDemoMode);
  const [notifications, setNotificationsState] = useState<InAppNotification[]>(() => initialDemoMode ? [] : loadSavedNotifications(currentUserId));
  const notificationsRef = useRef(notifications);
  const setNotifications = useCallback((update: React.SetStateAction<InAppNotification[]>) => {
    if (endingSessionRef.current) return;
    const next = isDemoMode
      ? (typeof update === 'function' ? update(notificationsRef.current) : update)
      : updateSavedNotifications(currentUserId,
        current => typeof update === 'function' ? update(current) : update, notificationsRef.current);
    notificationsRef.current = next;
    setNotificationsState(next);
  }, [currentUserId, isDemoMode]);
  const notificationSessionRef = useRef({ userId: currentUserId, startedAt: Date.now(), evaluated: false });
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_UI_PREFS;
    try {
      const saved = localStorage.getItem('ubc_ui_prefs_' + currentUserId);
      if (saved) {
        return { ...DEFAULT_UI_PREFS, ...JSON.parse(saved) };
      }
    } catch {}
    return DEFAULT_UI_PREFS;
  });

  // Focus Mode state ("Just one thing" anti-stress mode)
  const [focusModeActive, setFocusModeActive] = useState(false);

  // Toast notifications state (bottom-centre, 6-second auto-dismiss, with Undo)
  const [toast, setToast] = useState<ToastItem | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((options: { message: string; undo?: () => void }) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToast({
      id,
      message: options.message,
      undo: options.undo
    });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(prev => (prev?.id === id ? null : prev));
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Load notification & UI preferences from Firestore / localStorage
  useEffect(() => {
    if (isDemoMode) {
      setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
      setPrefsLoaded(true);
      return;
    }
    if (!user?.uid) {
      setPrefsLoaded(false);
      return;
    }

    setPrefsLoaded(false);
    let isMounted = true;
    fetchUserNotificationPrefs(user.uid).then(prefs => {
      if (isMounted) {
        setNotificationPrefs(prefs);
        setPrefsLoaded(true);
      }
    }).catch(err => {
      console.warn('Failed to fetch user notification prefs:', err);
      reportError(err, { source: 'TaskProvider.prefs.read' });
      if (isMounted) {
        setPrefsLoaded(true);
      }
    });

    try {
      const cached = localStorage.getItem('ubc_ui_prefs_' + user.uid);
      if (cached) {
        setUiPrefs(prev => ({ ...prev, ...JSON.parse(cached) }));
      }
    } catch {}

    fetchUserUiPrefs(user.uid).then(prefs => {
      if (isMounted && !endingSessionRef.current && prefs) {
        setUiPrefs(prefs);
        try {
          localStorage.setItem('ubc_ui_prefs_' + user.uid, JSON.stringify(prefs));
        } catch {}
      }
    }).catch(err => reportError(err, { source: 'TaskProvider.uiPrefs.read' }));

    return () => { isMounted = false; };
  }, [user?.uid, isDemoMode]);

  const updateUiPrefsHandler = useCallback((partial: Partial<UiPrefs>) => {
    setUiPrefs(prev => {
      const next: UiPrefs = { ...prev, ...partial };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('ubc_ui_prefs_' + currentUserId, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
    if (!isDemoMode && user?.uid) {
      updateUserUiPrefs(user.uid, partial).catch(err => {
        console.warn('Failed to sync uiPrefs to Firestore:', err);
        reportError(err, { source: 'TaskProvider.uiPrefs.write' });
      });
    }
  }, [currentUserId, isDemoMode, user?.uid]);

  const setViewModeHandler = useCallback((mode: ViewMode) => {
    updateUiPrefsHandler({ viewMode: mode });
  }, [updateUiPrefsHandler]);

  // Mirror the source of truth across tabs; demo notifications stay in memory.
  useEffect(() => {
    if (isDemoMode) {
      notificationsRef.current = [];
      setNotificationsState([]);
      return;
    }
    const sync = () => {
      if (endingSessionRef.current) return;
      const saved = loadSavedNotifications(currentUserId);
      notificationsRef.current = saved;
      setNotificationsState(saved);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === `ubc_inapp_notifications_${currentUserId}` || event.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [currentUserId, isDemoMode]);

  // Wait for a complete task list before removing persisted orphan reminders.
  // An empty or partial offline cache is not proof that a task was deleted.
  useEffect(() => {
    if (loading || (!isDemoMode && !hasLoadedTasksRef.current)) return;
    const ids = new Set(tasks.map(task => task.task_id));
    if (notifications.some(item => item.taskId && !ids.has(item.taskId))) {
      setNotifications(current => current.filter(item => !item.taskId || ids.has(item.taskId)));
    }
  }, [tasks, notifications, loading, isDemoMode, currentUserId, setNotifications]);

  // Keep recovery snapshots in memory. Firestore's IndexedDB cache handles offline persistence;
  // academic records (including grades and feedback) must not be duplicated in localStorage.
  useEffect(() => {
    checkpointRef.current = null;
    try {
      const key = `ubc_dashboard_auto_checkpoint_${currentUserId}`;
      const stored = localStorage.getItem(key) || localStorage.getItem('ubc_dashboard_checkpoint');
      const legacy = stored ? JSON.parse(stored) : null;
      if (!isDemoMode && legacy?.userId === currentUserId && Array.isArray(legacy.tasks)
        && !legacy.tasks.some((task: Task) => task.demo_seed || task.task_id?.startsWith('demo-'))) {
        checkpointRef.current = legacy;
      }
    } catch {} finally {
      try {
        localStorage.removeItem(`ubc_dashboard_auto_checkpoint_${currentUserId}`);
        localStorage.removeItem('ubc_dashboard_checkpoint');
      } catch {}
    }
  }, [currentUserId, isDemoMode]);

  useEffect(() => {
    if (endingSessionRef.current || loading || tasks.length === 0 || isDemoMode
      || tasks.some(task => task.demo_seed || task.task_id.startsWith('demo-'))) return;
    try {
      const autoSnapshot: DashboardBackupSnapshot = {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        userId: currentUserId,
        tasks,
        courses,
        classes,
        exams,
        notificationPrefs: sanitizeNotificationPrefsForExport(notificationPrefs),
        uiPrefs
      };
      checkpointRef.current = autoSnapshot;
    } catch {
      // Keep recovery optional if a snapshot cannot be constructed.
    }
  }, [tasks, courses, classes, exams, notificationPrefs, uiPrefs, currentUserId, isDemoMode, loading]);

  // Periodic and reactive notification evaluation engine
  useEffect(() => {
    // If not in demo mode and user notification preferences haven't loaded from Firestore yet, wait
    if (isDemoMode || loading || !prefsLoaded) {
      return;
    }

    const runEvaluation = () => {
      if (endingSessionRef.current) return;
      if (notificationSessionRef.current.userId !== currentUserId) {
        notificationSessionRef.current = { userId: currentUserId, startedAt: Date.now(), evaluated: false };
      }
      const session = notificationSessionRef.current;
      const result = evaluateNotifications({
        tasks,
        prefs: notificationPrefs,
        userId: currentUserId,
        currentNotifications: notifications,
        sessionStartedAt: session.startedAt,
        firstEvaluation: !session.evaluated
      });
      session.evaluated = true;

      if (result.newNotifications.length > 0) {
        setNotifications(prev => [...result.newNotifications, ...prev]);
      }

      if (result.updatedPrefs) {
        setNotificationPrefs(prev => ({ ...prev, ...result.updatedPrefs }));
        if (!isDemoMode && user?.uid) {
          updateUserNotificationPrefs(user.uid, { ...notificationPrefs, ...result.updatedPrefs })
            .catch(err => {
              console.warn('Failed to persist digest prefs', err);
              reportError(err, { source: 'TaskProvider.prefs.write' });
            });
        }
      }
    };

    // Run immediately when tasks or prefs change
    runEvaluation();

    // Check periodically every 30 seconds
    const interval = setInterval(runEvaluation, 30000);
    return () => clearInterval(interval);
  }, [tasks, notificationPrefs, currentUserId, notifications, isDemoMode, user?.uid, prefsLoaded, loading]);

  // Legacy feed settings remain in saved profiles for compatibility, but feeds
  // are no longer fetched or polled. Keep preferences available to other tools.
  const notificationPrefsRef = useRef(notificationPrefs);
  useEffect(() => { notificationPrefsRef.current = notificationPrefs; }, [notificationPrefs]);

  // Update notification preferences
  const updatePrefsHandler = async (newPrefs: NotificationPrefs) => {
    if (!isDemoMode && user?.uid) {
      try {
        await updateUserNotificationPrefs(user.uid, newPrefs);
      } catch (err) {
        console.error('Failed to update notification preferences in Firestore:', err);
        reportError(err, { source: 'TaskProvider.prefs.write' });
        throw err;
      }
    }
    notificationPrefsRef.current = newPrefs;
    setNotificationPrefs(newPrefs);
  };

  const markNotificationAsRead = (notificationId: string) => {
    setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n));
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearNotification = (notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const clearReminderHistoryHandler = () => {
    clearFiredHistory(currentUserId);
  };

  const triggerTestReminder = (leadMinutes: number = 60) => {
    const leadText = formatLeadTimeText(leadMinutes);
    const testTitle = 'Sample Assignment (Test Notification)';
    const testCourse = 'TEST';

    const notifTitle = `[TEST] ⏰ Deadline Reminder: ${testTitle}`;
    const notifBody = `[TEST] Example reminder — this is how deadline alerts look with the ${leadText} reminder setting. This example has no real deadline.`;

    const testNotif: InAppNotification = {
      id: `test_${Date.now()}`,
      taskTitle: testTitle,
      courseCode: testCourse,
      leadMinutes,
      type: 'test',
      title: notifTitle,
      body: notifBody,
      createdAt: new Date().toISOString(),
      read: false
    };

    setNotifications(prev => [testNotif, ...prev]);

    // Play audible notification chime
    playFocusCompletionChime();

    if (notificationPrefs.channels.push) {
      showBrowserNotification(notifTitle, notifBody);
    }
  };

  const triggerDigest = (type: 'daily' | 'weekly') => {
    const preview = generateDigestPreview(type, tasks);
    const title = `[TEST] ${preview.title} (${preview.count} Deadlines)`;
    const body = `[TEST] ${preview.summaryText} Preview only — no deadlines have been changed.`;
    const notification: InAppNotification = {
      id: `digest_test_${type}_${Date.now()}`,
      type: type === 'daily' ? 'daily_digest' : 'weekly_digest',
      title,
      body,
      createdAt: new Date().toISOString(),
      read: false
    };
    setNotifications(prev => [notification, ...prev]);
    if (notificationPrefs.channels.push) showBrowserNotification(title, body);
  };

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter(n => !n.read).length;
  }, [notifications]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (!retryStoppedRef.current) setSubscriptionVersion(prev => prev + 1);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Main subscriptions for tasks, courses, classes, exams
  useEffect(() => {
    if (isDemoMode) {
      // Seed demo data ONLY once on entering demo mode to preserve user edits & created groups
      if (!hasSeededDemoRef.current) {
        hasSeededDemoRef.current = true;
        demoTasksBaselineRef.current = getDemoTasks();
        setTasks(demoTasksBaselineRef.current);
        demoCoursesBaselineRef.current = FICTIONAL_SAMPLE_COURSES.map(course => ({ ...course, ...getDemoTerm() }));
        setCourses(demoCoursesBaselineRef.current);
        setClasses(DEMO_CLASSES);
        demoExamsBaselineRef.current = getDemoExams();
        setExams(demoExamsBaselineRef.current);
        setGroups(DEMO_GROUPS);
        if (DEMO_GROUPS.length > 0) {
          setActiveGroupId(prev => prev || DEMO_GROUPS[0].id);
        }
      }
      setLoading(false);
      setLastSync(null);
      setHasPendingWrites(false);
      return;
    }

    hasSeededDemoRef.current = false;

    if (!user?.uid) {
      setTasks([]);
      setCourses([]);
      setClasses([]);
      setExams([]);
      setGroups([]);
      setGroupTasks([]);
      setActiveGroupId(null);
      setLoading(false);
      return;
    }

    // Sync user profile
    syncUserProfile(user);

    let retryTimeout: NodeJS.Timeout | null = null;
    let unsubscribed = false;

    hasLoadedTasksRef.current = false;

    const markSubscriptionHealthy = (source: string) => {
      retryCountsRef.current[source] = 0;
      if (Object.values(retryCountsRef.current).every(count => count === 0) && !retryStoppedRef.current) {
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = null;
        setError(null);
      }
    };

    const handleSubscriptionError = (source: string, err: any) => {
      if (unsubscribed || endingSessionRef.current) return;
      console.error(`${source} subscription error:`, err);
      reportError(err, { source: `TaskProvider.listener.${source}` });
      const code = err?.code;
      setLoading(false);
      if (code === 'permission-denied' || code === 'unauthenticated'
        || err?.message?.includes('Missing or insufficient permissions')) {
        retryStoppedRef.current = true;
        unsubscribed = true;
        if (retryTimeout) clearTimeout(retryTimeout);
        setError('Your session has ended or credentials were revoked. Please sign in again.');
        void handleLogout();
        return;
      }
      if (code === 'resource-exhausted') {
        retryStoppedRef.current = true;
        if (retryTimeout) clearTimeout(retryTimeout);
        setError('Cloud storage quota has been reached. Automatic retries are paused. Try reloading later; contact support if this continues.');
        return;
      }
      const attempts = retryCountsRef.current[source] || 0;
      const transient = ['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'unknown'].includes(code);
      if (!transient || attempts >= 6 || retryStoppedRef.current) {
        retryStoppedRef.current = true;
        if (retryTimeout) clearTimeout(retryTimeout);
        setError('Cloud sync could not reconnect. Automatic retries are paused. Try reloading later; contact support if this continues.');
        return;
      }
      retryCountsRef.current[source] = attempts + 1;
      setError('Cloud sync is temporarily unavailable. Reconnecting with a limited number of retries…');
      if (retryTimeout) return;
      const delay = Math.min(180000, 5000 * 2 ** attempts * (0.75 + Math.random() * 0.5));
      retryTimeout = setTimeout(() => {
        if (!unsubscribed && !retryStoppedRef.current) setSubscriptionVersion(prev => prev + 1);
      }, delay);
    };

    // Subscribe to tasks. Only a server acknowledgment proves recovery.
    const unsubTasks = subscribeToTasks(
      user.uid,
      (updatedTasks, metadata) => {
        if (unsubscribed || endingSessionRef.current) return;
        if (!metadata?.fromCache && !metadata?.hasPendingWrites) {
          hasLoadedTasksRef.current = true;
          markSubscriptionHealthy('tasks');
        }
        setTasks(updatedTasks);
        setLastSync(new Date());
        setLoading(false);
        setHasPendingWrites(metadata?.hasPendingWrites || false);
      },
      err => handleSubscriptionError('tasks', err)
    );

    // Subscribe to courses
    const unsubCourses = subscribeToCourses(
      user.uid,
      (updatedCourses, metadata) => {
        if (unsubscribed || endingSessionRef.current) return;
        if (metadata && !metadata.fromCache && !metadata.hasPendingWrites) markSubscriptionHealthy('courses');
        setCourses(updatedCourses);
      },
      err => handleSubscriptionError('courses', err)
    );

    // Subscribe to class schedule
    const unsubClasses = subscribeToClassSchedule(
      user.uid,
      (updatedClasses, metadata) => {
        if (unsubscribed || endingSessionRef.current) return;
        if (metadata && !metadata.fromCache && !metadata.hasPendingWrites) markSubscriptionHealthy('classes');
        setClasses(updatedClasses);
      },
      err => handleSubscriptionError('classes', err)
    );

    // Subscribe to exams
    const unsubExams = subscribeToExams(
      user.uid,
      (updatedExams, metadata) => {
        if (unsubscribed || endingSessionRef.current) return;
        if (metadata && !metadata.fromCache && !metadata.hasPendingWrites) markSubscriptionHealthy('exams');
        setExams(updatedExams);
      },
      err => handleSubscriptionError('exams', err)
    );

    // Subscribe to user's group projects
    const unsubGroups = subscribeToUserGroups(
      user.uid,
      (userGroups, metadata) => {
        if (unsubscribed || endingSessionRef.current) return;
        if (metadata && !metadata.fromCache && !metadata.hasPendingWrites) markSubscriptionHealthy('groups');
        setGroups(userGroups);
        if (userGroups.length > 0) {
          setActiveGroupId(prev => (prev && userGroups.some(g => g.id === prev)) ? prev : userGroups[0].id);
        } else {
          setActiveGroupId(null);
        }
      },
      err => handleSubscriptionError('groups', err)
    );

    return () => {
      unsubscribed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      unsubTasks();
      unsubCourses();
      unsubClasses();
      unsubExams();
      unsubGroups();
    };
  }, [user?.uid, isDemoMode, subscriptionVersion]);

  // Subscribe to tasks within currently active group project
  useEffect(() => {
    setGroupTasks([]);
    if (isDemoMode) {
      setGroupTasks(DEMO_GROUP_TASKS.filter(task => task.group_id === activeGroupId));
      return;
    }
    if (!activeGroupId) return;
    let subscribed = true;
    const unsubGroupTasks = subscribeToGroupTasks(
      activeGroupId,
      (tasks) => {
        if (subscribed) setGroupTasks(tasks);
      },
      (err) => {
        if (!subscribed) return;
        setGroupTasks([]);
        console.warn('Group tasks sync warning:', err);
        reportError(err, { source: 'TaskProvider.listener.groupTasks' });
      }
    );
    return () => {
      subscribed = false;
      unsubGroupTasks();
    };
  }, [activeGroupId, isDemoMode, user?.uid]);

  // Keep a ref to prevent double-logging completion for the same focus session interval across ticks/tabs
  const completedSessionsLoggedRef = useRef<Set<string>>(new Set());
  const tabIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );

  // Helper to persist focus timer state transitions only (NOT on 1-second ticks)
  const persistFocusTimerTransition = useCallback((state: ActiveFocusState | null) => {
    if (typeof window === 'undefined') return;
    const uid = currentUserId;
    const namespacedKey = `ubc_active_focus_timer_${uid}`;
    try {
      if (state) {
        // Persist essential state without fluctuating secondsLeft; derived from endsAt/pausedRemaining
        const toStore = {
          userId: uid,
          taskId: state.taskId,
          taskTitle: state.taskTitle,
          courseCode: state.courseCode,
          durationSeconds: state.durationSeconds,
          mode: state.mode,
          isRunning: state.isRunning,
          completed: state.completed,
          startedAt: state.startedAt,
          endsAt: state.endsAt,
          pausedAt: state.pausedAt,
          pausedRemaining: state.pausedRemaining,
          loggedSeconds: state.loggedSeconds,
          sessionCount: state.sessionCount,
          sessionId: state.sessionId,
          updatedAt: Date.now()
        };
        localStorage.setItem(namespacedKey, JSON.stringify(toStore));
        localStorage.removeItem('ubc_active_focus_timer');
      } else {
        localStorage.removeItem(namespacedKey);
        localStorage.removeItem('ubc_active_focus_timer');
      }
    } catch {}

    // Synchronize transition across open tabs via BroadcastChannel if available
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel('ubc_focus_timer_channel');
        channel.postMessage({
          type: state ? 'TIMER_SYNC' : 'TIMER_CLEAR',
          payload: state ? { ...state, userId: uid } : null,
          userId: uid,
          senderTabId: tabIdRef.current
        });
        channel.close();
      } catch {}
    }
  }, [currentUserId]);

  // Validate restored or synchronized timers only after this account's tasks load.
  useEffect(() => {
    if (!activeFocus || (!isDemoMode && !hasLoadedTasksRef.current)) return;
    if (!tasks.some(task => task.task_id === activeFocus.taskId)) {
      setActiveFocus(null);
      persistFocusTimerTransition(null);
    }
  }, [tasks, activeFocus, isDemoMode, persistFocusTimerTransition]);

  // Listen to cross-tab storage and BroadcastChannel events to mirror focus timer transitions across tabs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const namespacedKey = `ubc_active_focus_timer_${currentUserId}`;
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== namespacedKey) return;
      if (!e.newValue) {
        setActiveFocus(null);
        return;
      }
      const parsed = parseValidFocusTimer(e.newValue, currentUserId);
      if (parsed && (!parsed.userId || parsed.userId === currentUserId)) {
        setActiveFocus(parsed);
      } else {
        setActiveFocus(null);
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('ubc_focus_timer_channel');
        channel.onmessage = (event) => {
          if (event.data?.senderTabId === tabIdRef.current) return;
          if (event.data?.userId && event.data.userId !== currentUserId) return;
          if (event.data?.type === 'TIMER_CLEAR') {
            setActiveFocus(null);
          } else if (event.data?.type === 'TIMER_SYNC') {
            const parsed = parseValidFocusTimer(event.data?.payload, currentUserId);
            if (parsed && (!parsed.userId || parsed.userId === currentUserId)) {
              setActiveFocus(parsed);
            }
          }
        };
      } catch {}
    }

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (channel) {
        try { channel.close(); } catch {}
      }
    };
  }, [currentUserId]);

  // Focus timer countdown tick (in-memory only, does not rewrite localStorage every second)
  useEffect(() => {
    if (!activeFocus || !activeFocus.isRunning) return;

    const interval = setInterval(() => {
      setActiveFocus(prev => {
        if (!prev || !prev.isRunning) return prev;

        // Derive actual remaining seconds from wall-clock endsAt to avoid drift and handle sleep
        let currentSecondsLeft = prev.secondsLeft - 1;
        if (prev.endsAt) {
          const delta = Math.round((prev.endsAt - Date.now()) / 1000);
          currentSecondsLeft = delta;
        }

        if (currentSecondsLeft <= 0) {
          // Timer finished!
          if (prev.completed) return prev;

          const { endsAt, ...timer } = prev;
          return {
            ...timer,
            justCompleted: true,
            secondsLeft: 0,
            pausedRemaining: 0,
            loggedSeconds: prev.durationSeconds,
            completed: true,
            isRunning: false,
            sessionCount: (prev.sessionCount || 0) + 1
          };
        }

        // The separate clock context updates the display; dashboard state changes only on completion.
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeFocus?.isRunning, activeFocus?.durationSeconds]);

  // Recompute timer countdown on visibilitychange to immediately catch up when returning from background tabs or system sleep
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;

      setActiveFocus(prev => {
        if (!prev || !prev.isRunning || !prev.endsAt) return prev;
        const remaining = Math.round((prev.endsAt - Date.now()) / 1000);

        if (remaining <= 0) {
          if (prev.completed) return prev;

          const { endsAt, ...timer } = prev;
          return {
            ...timer,
            justCompleted: true,
            secondsLeft: 0,
            pausedRemaining: 0,
            loggedSeconds: prev.durationSeconds,
            completed: true,
            isRunning: false,
            sessionCount: (prev.sessionCount || 0) + 1
          };
        }

        return prev;
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!activeFocus?.justCompleted || !activeFocus.completed || activeFocus.userId !== currentUserId
      || !tasks.some(task => task.task_id === activeFocus.taskId)) return;
    const sessionKey = activeFocus.sessionId || `${activeFocus.taskId}_${activeFocus.startedAt || ''}_${activeFocus.sessionCount}`;
    if (completedSessionsLoggedRef.current.has(sessionKey)) return;
    completedSessionsLoggedRef.current.add(sessionKey);
    persistFocusTimerTransition(activeFocus);
    playFocusCompletionChime();

    const completedMinutes = Math.max(1, Math.round(activeFocus.durationSeconds / 60));
    if (notificationPrefs.channels.push) {
      showBrowserNotification(
        '🎉 Focus Session Finished!',
        `Awesome job! You logged ${completedMinutes} focused minutes on ${activeFocus.taskTitle || 'your task'}.`
      );
    }
    const notif: InAppNotification = {
      id: `focus_complete_${sessionKey}`,
      ...(activeFocus.taskId ? { taskId: activeFocus.taskId } : {}),
      taskTitle: activeFocus.taskTitle,
      courseCode: activeFocus.courseCode,
      type: 'test',
      title: `🎯 Focus Interval Complete (${completedMinutes}m)`,
      body: `Great focus session on ${activeFocus.taskTitle}. Time has been recorded.`,
      createdAt: new Date().toISOString(),
      read: false
    };
    setNotifications(n => [notif, ...n]);
    if (activeFocus.taskId) {
      logManualFocusTime(activeFocus.taskId, completedMinutes, activeFocus.mode, 'Completed interval', sessionKey)
        .catch(err => {
          console.warn('Focus session auto-log warning:', err);
          reportError(err, { source: 'TaskProvider.focus.write' });
        });
    }
  }, [activeFocus, currentUserId, tasks, notificationPrefs.channels.push, persistFocusTimerTransition]);

  // Focus timer actions
  const startFocusTimer = (task: { id: string; title: string; course: string }, durationMinutes: number = 25, mode: FocusTimerMode = 'pomodoro') => {
    const durationSeconds = Math.max(60, durationMinutes * 60);
    const now = Date.now();
    const sessionId = `fs_sess_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const newState: ActiveFocusState = {
      userId: currentUserId,
      taskId: task.id,
      taskTitle: task.title,
      courseCode: task.course,
      durationSeconds,
      secondsLeft: durationSeconds,
      isRunning: true,
      mode,
      sessionCount: 0,
      startedAt: new Date().toISOString(),
      endsAt: now + durationSeconds * 1000,
      pausedRemaining: undefined,
      sessionId,
      loggedSeconds: 0,
      completed: false
    };
    setActiveFocus(newState);
    persistFocusTimerTransition(newState);
  };

  const pauseFocusTimer = () => {
    setActiveFocus(prev => {
      if (!prev) return null;
      const currentSeconds = prev.endsAt
        ? Math.max(0, Math.round((prev.endsAt - Date.now()) / 1000))
        : (prev.pausedRemaining ?? prev.secondsLeft);
      const pausedState: ActiveFocusState = {
        ...prev,
        secondsLeft: currentSeconds,
        pausedRemaining: currentSeconds,
        isRunning: false,
        pausedAt: Date.now(),
        endsAt: undefined
      };
      persistFocusTimerTransition(pausedState);
      return pausedState;
    });
  };

  const resumeFocusTimer = () => {
    setActiveFocus(prev => {
      if (!prev) return null;
      const now = Date.now();
      const sessionId = prev.sessionId || `fs_sess_${now}_${Math.random().toString(36).slice(2, 7)}`;
      if (prev.completed) {
        const restartedState: ActiveFocusState = {
          ...prev,
          secondsLeft: prev.durationSeconds,
          endsAt: now + prev.durationSeconds * 1000,
          pausedRemaining: undefined,
          sessionId,
          loggedSeconds: 0,
          completed: false,
          isRunning: true,
          startedAt: new Date().toISOString(),
          pausedAt: undefined
        };
        persistFocusTimerTransition(restartedState);
        return restartedState;
      }
      const remainingSecs = typeof prev.pausedRemaining === 'number' ? prev.pausedRemaining : prev.secondsLeft;
      const resumedState: ActiveFocusState = {
        ...prev,
        secondsLeft: remainingSecs,
        isRunning: true,
        endsAt: now + remainingSecs * 1000,
        pausedRemaining: undefined,
        sessionId,
        pausedAt: undefined
      };
      persistFocusTimerTransition(resumedState);
      return resumedState;
    });
  };

  const resetFocusTimer = () => {
    setActiveFocus(prev => {
      if (!prev) return null;
      const resetState: ActiveFocusState = {
        ...prev,
        secondsLeft: prev.durationSeconds,
        endsAt: undefined,
        pausedRemaining: undefined,
        pausedAt: undefined,
        loggedSeconds: 0,
        completed: false,
        isRunning: false
      };
      persistFocusTimerTransition(resetState);
      return resetState;
    });
  };

  const stopAndLogFocusTimer = async (minutesToLog?: number) => {
    if (!activeFocus) return;
    const focusToStop = activeFocus;

    // Immediately clear activeFocus state and persist removal so UI closes instantly without waiting on network
    setActiveFocus(null);
    persistFocusTimerTransition(null);

    let currentSecondsLeft = focusToStop.pausedRemaining ?? focusToStop.secondsLeft;
    if (focusToStop.isRunning && focusToStop.endsAt) {
      currentSecondsLeft = Math.max(0, (focusToStop.endsAt - Date.now()) / 1000);
    }
    const elapsedSeconds = Math.max(0, focusToStop.durationSeconds - currentSecondsLeft);
    const loggedSeconds = focusToStop.loggedSeconds || 0;
    const unloggedSeconds = Math.max(0, elapsedSeconds - loggedSeconds);
    const remainderMinutes = unloggedSeconds < 30 ? 0 : Math.min(480, Math.round(unloggedSeconds / 60));

    const minutes = typeof minutesToLog === 'number' && Number.isFinite(minutesToLog)
      ? Math.min(Math.max(0, Math.round(minutesToLog)), remainderMinutes)
      : remainderMinutes;

    if (focusToStop.taskId && minutes > 0) {
      // Fire-and-forget: perform optimistic local update and do not await Firestore network promise
      logManualFocusTime(focusToStop.taskId, minutes, focusToStop.mode, 'Manual log from timer', focusToStop.sessionId)
        .catch(err => {
          console.error('Failed to sync focus session to cloud:', err);
          reportError(err, { source: 'TaskProvider.focus.write' });
          setError('Focus session saved locally. Cloud sync will resume when online.');
        });
    }
  };

  const logManualFocusTime = async (
    taskId: string,
    minutes: number,
    mode: FocusTimerMode = 'custom',
    notes?: string,
    customSessionId?: string
  ) => {
    const sessionId = customSessionId || `fs-${Date.now()}`;
    const session: FocusSession = {
      id: sessionId,
      duration_minutes: minutes,
      mode,
      completed_at: new Date().toISOString(),
      notes
    };

    // Optimistic update in local state - ensure idempotent addition
    setTasks(prev => prev.map(t => {
      if (t.task_id === taskId) {
        const currentMins = t.logged_minutes || 0;
        const currentSessions = t.focus_sessions || [];
        // Prevent duplicate session in local state if already present
        if (currentSessions.some(s => s.id === sessionId)) {
          return t;
        }
        return {
          ...t,
          logged_minutes: currentMins + minutes,
          focus_sessions: [session, ...currentSessions]
        };
      }
      return t;
    }));

    if (isDemoMode || !user?.uid) return;

    // Fire-and-forget: write to Firestore asynchronously so offline clients do not hang
    logFirestoreFocusSession(user.uid, taskId, session).catch(err => {
      console.error('Failed to log focus session to Firestore:', err);
      reportError(err, { source: 'TaskProvider.focus.write' });
      if (err?.code === 'not-found') showToast({ message: 'This task no longer exists. Focus time was not saved to the cloud.' });
      setError(err?.code === 'not-found'
        ? 'Task no longer exists. Focus time was not saved to the cloud.'
        : 'Focus session saved locally. Cloud sync will resume when online.');
    });
  };

  // Group Workspace actions
  const createGroup = async (data: { name: string; course_code: string; description?: string; target_date?: string }): Promise<GroupProject> => {
    const userProfile = {
      displayName: user?.displayName || 'Student',
      email: user?.email || '',
      photoURL: user?.photoURL || ''
    };

    if (isDemoMode || !user?.uid) {
      const newGroup: GroupProject = {
        id: `demo-group-${Date.now()}`,
        name: data.name,
        course_code: data.course_code,
        description: data.description,
        created_by: 'demo-student',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        invite_code: `LMS${Math.floor(100 + Math.random() * 900)}`,
        members: ['demo-student'],
        member_details: {
          'demo-student': {
            uid: 'demo-student',
            displayName: userProfile.displayName,
            email: userProfile.email,
            role: 'owner',
            joinedAt: new Date().toISOString()
          }
        },
        target_date: data.target_date
      };
      setGroups(prev => [newGroup, ...prev]);
      setActiveGroupId(newGroup.id);
      return newGroup;
    }

    const created = await createFirestoreGroupProject(user.uid, userProfile, data);
    setGroups(prev => [created, ...prev.filter(g => g.id !== created.id)]);
    setActiveGroupId(created.id);
    return created;
  };

  const joinGroupByCode = async (code: string): Promise<GroupProject | null> => {
    const userProfile = {
      displayName: user?.displayName || 'Student',
      email: user?.email || '',
      photoURL: user?.photoURL || ''
    };

    if (isDemoMode || !user?.uid) {
      const found = DEMO_GROUPS.find(g => g.invite_code.toUpperCase() === code.toUpperCase().trim());
      if (found) {
        setGroups(prev => prev.some(g => g.id === found.id) ? prev : [found, ...prev]);
        setActiveGroupId(found.id);
        return found;
      }
      throw new Error(`No group found with invite code "${code}". Try "DEMO310".`);
    }

    const joined = await joinFirestoreGroupByCode(user.uid, userProfile, code);
    if (joined) {
      setGroups(prev => [joined, ...prev.filter(g => g.id !== joined.id)]);
      setActiveGroupId(joined.id);
    }
    return joined;
  };

  const leaveGroup = async (groupId: string): Promise<void> => {
    setGroups(prev => prev.filter(g => g.id !== groupId));
    if (activeGroupId === groupId) {
      setActiveGroupId(groups.find(g => g.id !== groupId)?.id || null);
    }

    if (isDemoMode || !user?.uid) return;
    await leaveFirestoreGroup(user.uid, groupId);
  };

  const saveGroupTaskAction = async (groupId: string, task: Partial<GroupTask> & { title: string }): Promise<string> => {
    const existing = task.id ? groupTasks.find(item => item.id === task.id) : null;
    if (groupId !== activeGroupId || !groups.some(group => group.id === groupId)
      || (task.group_id && task.group_id !== groupId)
      || (task.id && (!existing || existing.group_id !== groupId))) {
      throw new Error('This task is no longer in the active group. Reopen the group and try again.');
    }
    if (isDemoMode || !user?.uid) {
      const taskId = task.id || `gtask-${Date.now()}`;
      const updated: GroupTask = {
        id: taskId,
        group_id: groupId,
        title: task.title,
        description: task.description || '',
        status: task.status || 'Not Started',
        priority: task.priority || 'Medium',
        due_at: task.due_at || '',
        ...(task.assigned_to ? { assigned_to: task.assigned_to } : {}),
        ...(task.assignee_name ? { assignee_name: task.assignee_name } : {}),
        ...(typeof task.estimated_hours === 'number' ? { estimated_hours: task.estimated_hours } : {}),
        logged_hours: task.logged_hours || 0,
        subtasks: task.subtasks || [],
        created_by: 'demo-student',
        created_by_name: user?.displayName || 'Demo Student',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      setGroupTasks(prev => {
        const existing = prev.some(t => t.id === taskId);
        return existing ? prev.map(t => t.id === taskId ? updated : t) : [updated, ...prev];
      });
      return taskId;
    }

    return await saveFirestoreGroupTask(groupId, task, user.uid, user.displayName || 'Student');
  };

  const deleteGroupTaskAction = async (groupId: string, taskId: string): Promise<void> => {
    const task = groupTasks.find(item => item.id === taskId);
    if (groupId !== activeGroupId || !groups.some(group => group.id === groupId) || task?.group_id !== groupId) {
      throw new Error('This task is no longer in the active group. Reopen the group and try again.');
    }
    setGroupTasks(prev => prev.filter(t => t.id !== taskId));
    if (isDemoMode || !user?.uid) return;
    await deleteFirestoreGroupTask(groupId, taskId);
  };

  const refreshTasks = useCallback(async () => {
    if (isDemoMode) return;
    if (!user?.uid) return;

    setLoading(true);
    try {
      const [fetchedTasks, fetchedCourses] = await Promise.all([fetchUserTasks(user.uid), fetchUserCourses(user.uid)]);
      hasLoadedTasksRef.current = true;
      setTasks(fetchedTasks);
      setCourses(fetchedCourses);
      setLastSync(new Date());
      setError(null);
    } catch (err: any) {
      console.error('Manual refresh tasks error:', err);
      reportError(err, { source: 'TaskProvider.refresh' });
      setError("Could not refresh tasks right now. We'll keep trying in the background.");
    } finally {
      setLoading(false);
    }
  }, [user?.uid, isDemoMode]);

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    const previousTask = tasksRef.current.find(t => t.task_id === taskId) || tasks.find(t => t.task_id === taskId);
    const prevStatus = previousTask?.status;
    const isMarkingDone = Boolean(
      prevStatus &&
      updates.status &&
      (updates.status === 'Done' || updates.status === 'Submitted') &&
      prevStatus !== updates.status
    );

    const isSnoozing = Boolean(
      updates.check_again_at &&
      updates.check_again_at !== '' &&
      updates.check_again_at !== previousTask?.check_again_at
    );

    let snoozeTomorrowDate: Date | null = null;
    if (isSnoozing) {
      snoozeTomorrowDate = addDays(new Date(), 1);
      const snoozeIso = snoozeTomorrowDate.toISOString();
      updates.check_again_at = snoozeIso;
    }

    // Build separate local patch for React state that omits Firestore FieldValue sentinels
    const localPatch: any = { ...updates };
    for (const [key, value] of Object.entries(updates)) {
      if (
        value instanceof FieldValue ||
        (value && typeof value === 'object' && value.constructor && /FieldValue|DeleteField/.test(value.constructor.name))
      ) {
        localPatch[key] = undefined;
      }
    }

    setTasks(prev => {
      return prev.map(t => {
        if (t.task_id !== taskId) return t;
        const next = { ...t, ...localPatch };
        for (const [key, val] of Object.entries(localPatch)) {
          if (val === undefined) {
            delete (next as any)[key];
          }
        }
        if (updates.canvas_date_diff && typeof (updates.canvas_date_diff as any)?.isEqual === 'function') {
          delete next.canvas_date_diff;
        }
        return next;
      });
    });

    if (isMarkingDone && prevStatus) {
      const capturedStatus = prevStatus;
      showToast({
        message: 'Marked done',
        undo: () => {
          updateTask(taskId, { status: capturedStatus });
        }
      });
    }

    if (isSnoozing && snoozeTomorrowDate) {
      const weekdayTime = formatInTimeZone(snoozeTomorrowDate, TIMEZONE, 'EEEE, h:mm a');
      showToast({
        message: `Hidden until ${weekdayTime}`,
        undo: () => {
          updateTask(taskId, { check_again_at: '' });
        }
      });
    }

    if (isDemoMode || !user?.uid) return;

    try {
      await updateFirestoreTask(user.uid, taskId, updates);
      setWriteError(null);
      setLastSync(new Date());
    } catch (err: any) {
      console.error('Update task error:', err);
      reportWriteError(err, "We couldn't save your latest change. Check your connection and try again.");
      if (previousTask) {
        const orig = previousTask;
        setTasks(prev => prev.map(t => t.task_id === taskId ? orig : t));
      }
      throw err;
    }
  };

  const addTask = async (task: Task) => {
    setTasks(prev => [task, ...prev.filter(t => t.task_id !== task.task_id)]);

    if (task.type === 'announcement') {
      showToast({
        message: 'Announcement added. View it anytime in the Announcements tab.'
      });
    }

    if (isDemoMode || !user?.uid) return;

    try {
      await addFirestoreTask(user.uid, task);
      setWriteError(null);
      setLastSync(new Date());
    } catch (err: any) {
      console.error('Add task error:', err);
      reportWriteError(err, "We couldn't add your task right now. Try again in a moment.");
      setTasks(prev => prev.filter(t => t.task_id !== task.task_id));
      throw err;
    }
  };

  const batchAddTasks = async (newTasks: Task[]) => {
    if (newTasks.length === 0) return;
    const newIds = new Set(newTasks.map(t => t.task_id));
    setTasks(prev => [...newTasks, ...prev.filter(t => !newIds.has(t.task_id))]);

    if (isDemoMode || !user?.uid) return;

    try {
      await batchImportTasksAndCourses(user.uid, newTasks, []);
      setWriteError(null);
      setLastSync(new Date());
      setError(null);
    } catch (err: any) {
      console.error('Batch add tasks error:', err);
      reportWriteError(err, "Import didn't finish. Try again or paste a smaller section.");
      throw err;
    }
  };

  const deleteTask = async (taskId: string) => {
    const targetTask = tasksRef.current.find(t => t.task_id === taskId) || tasks.find(t => t.task_id === taskId);
    const taskToRestore = targetTask ? { ...targetTask } : undefined;

    const removedNotifications = notificationsRef.current.filter(item => item.taskId === taskId);
    setNotifications(current => current.filter(item => item.taskId !== taskId));
    setTasks(prev => prev.filter(t => t.task_id !== taskId));

    // If deleting a Canvas-sourced task, record it in dismissedCanvasIds so auto-sync never re-imports it
    const isCanvasTask = targetTask && (targetTask.source === 'canvas' || targetTask.task_id.startsWith('canvas-') || !!targetTask.canvas_url);
    if (isCanvasTask) {
      setNotificationPrefs(prev => {
        const currentDismissed = prev.dismissedCanvasIds || [];
        if (currentDismissed.includes(taskId)) return prev;
        const updated = {
          ...prev,
          dismissedCanvasIds: [...currentDismissed, taskId]
        };
        notificationPrefsRef.current = updated;
        if (!isDemoMode && user?.uid) {
          updateUserNotificationPrefs(user.uid, updated).catch(err => {
            console.warn('Failed to persist dismissedCanvasIds:', err);
            reportError(err, { source: 'TaskProvider.prefs.write' });
          });
        }
        return updated;
      });
    }

    if (taskToRestore) {
      showToast({
        message: 'Task deleted',
        undo: () => {
          // If restoring a Canvas task, remove it from dismissedCanvasIds
          const isCanvasTaskRestore = taskToRestore.source === 'canvas' || taskToRestore.task_id.startsWith('canvas-') || !!taskToRestore.canvas_url;
          if (isCanvasTaskRestore) {
            setNotificationPrefs(prev => {
              const currentDismissed = prev.dismissedCanvasIds || [];
              const updated = {
                ...prev,
                dismissedCanvasIds: currentDismissed.filter(id => id !== taskId)
              };
              notificationPrefsRef.current = updated;
              if (!isDemoMode && user?.uid) {
                updateUserNotificationPrefs(user.uid, updated).catch(err => {
                  console.warn('Failed to update dismissedCanvasIds on undo:', err);
                  reportError(err, { source: 'TaskProvider.prefs.write' });
                });
              }
              return updated;
            });
          }
          addTask(taskToRestore);
        }
      });
    }

    if (isDemoMode || !user?.uid) return;

    try {
      await deleteFirestoreTask(user.uid, taskId);
      setWriteError(null);
      setLastSync(new Date());
    } catch (err: any) {
      console.error('Delete task error:', err);
      reportWriteError(err, "We couldn't delete the task right now. Try again in a moment.");
      if (taskToRestore) {
        setTasks(prev => [taskToRestore, ...prev]);
        setNotifications(current => [...current, ...removedNotifications.filter(item => !current.some(existing => existing.id === item.id))]);
      }
      throw err;
    }
  };

  /**
   * V4-112: Dismisses review inbox tasks (either selected IDs or all tasks with needs_review),
   * updates the dismissedCanvasIds tombstone set so calendar sync won't resurrect them,
   * removes them from local state, and deletes them from Firestore.
   */
  const dismissReviewTasks = async (taskIds?: string[]) => {
    const idsToDismiss = new Set(
      taskIds && taskIds.length > 0
        ? taskIds
        : tasksRef.current.filter(t => t.needs_review).map(t => t.task_id)
    );
    if (idsToDismiss.size === 0) return;

    // Collect Canvas UIDs for tombstone set to prevent auto-sync resurrection
    const dismissedCanvasIdsToAdd: string[] = [];
    tasksRef.current.forEach(t => {
      if (idsToDismiss.has(t.task_id)) {
        if (t.source === 'canvas' || t.task_id.startsWith('canvas-') || !!t.canvas_url) {
          dismissedCanvasIdsToAdd.push(t.task_id);
        }
      }
    });

    // Remove from local tasks state
    setTasks(prev => prev.filter(t => !idsToDismiss.has(t.task_id)));

    // Persist to dismissedCanvasIds tombstone set
    if (dismissedCanvasIdsToAdd.length > 0) {
      setNotificationPrefs(prev => {
        const currentDismissed = new Set(prev.dismissedCanvasIds || []);
        dismissedCanvasIdsToAdd.forEach(id => currentDismissed.add(id));
        const updated = {
          ...prev,
          dismissedCanvasIds: Array.from(currentDismissed)
        };
        notificationPrefsRef.current = updated;
        if (!isDemoMode && user?.uid) {
          updateUserNotificationPrefs(user.uid, updated).catch(err => {
            console.warn('Failed to persist dismissedCanvasIds in dismissReviewTasks:', err);
            reportError(err, { source: 'TaskProvider.prefs.write' });
          });
        }
        return updated;
      });
    }

    // Delete in Firestore
    if (!isDemoMode && user?.uid) {
      for (const id of idsToDismiss) {
        deleteFirestoreTask(user.uid, id).catch(err => {
          console.warn('Failed to delete review task in cloud:', err);
          reportError(err, { source: 'TaskProvider.review.write' });
        });
      }
    }

    showToast({
      message: `Dismissed ${idsToDismiss.size} review ${idsToDismiss.size === 1 ? 'item' : 'items'}`
    });
  };

  // Class Schedule operations
  const addClassItem = async (item: ClassScheduleItem) => {
    setClasses(prev => [...prev.filter(c => c.id !== item.id), item]);
    if (isDemoMode || !user?.uid) return;
    await saveFirestoreClassScheduleItem(user.uid, item);
  };

  const updateClassItem = async (id: string, updates: Partial<ClassScheduleItem>) => {
    setClasses(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    if (isDemoMode || !user?.uid) return;
    const item = classes.find(c => c.id === id);
    if (item) {
      await saveFirestoreClassScheduleItem(user.uid, { ...item, ...updates });
    }
  };

  const deleteClassItem = async (id: string) => {
    setClasses(prev => prev.filter(c => c.id !== id));
    if (isDemoMode || !user?.uid) return;
    await deleteFirestoreClassScheduleItem(user.uid, id);
  };

  // Exam operations
  const addExamItem = async (item: ExamItem) => {
    setExams(prev => [...prev.filter(e => e.id !== item.id), item]);
    if (isDemoMode || !user?.uid) return;
    await saveFirestoreExamItem(user.uid, item);
  };

  const updateExamItem = async (id: string, updates: Partial<ExamItem>) => {
    setExams(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    if (isDemoMode || !user?.uid) return;
    await saveFirestoreExamItem(user.uid, { id, ...updates });
  };

  const deleteExamItem = async (id: string) => {
    setExams(prev => prev.filter(e => e.id !== id));
    if (isDemoMode || !user?.uid) return;
    await deleteFirestoreExamItem(user.uid, id);
  };

  // Full backup & restore
  const exportFullBackup = async (): Promise<DashboardBackupSnapshot> => {
    if (isDemoMode || !user?.uid) {
      return {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        userId: 'demo_student',
        isDemo: true,
        tasks,
        courses,
        classes,
        exams,
        notificationPrefs: sanitizeNotificationPrefsForExport(notificationPrefs),
        uiPrefs
      };
    }
    const rawSnapshot = await createFullDashboardBackup(user.uid);
    return {
      ...rawSnapshot,
      notificationPrefs: sanitizeNotificationPrefsForExport(rawSnapshot.notificationPrefs)
    };
  };

  const restoreFullBackup = async (
    snapshot: DashboardBackupSnapshot,
    mode: 'merge' | 'replace' = 'merge'
  ) => {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid backup file.');
    const fromDemo = snapshot.isDemo === true || ['demo_student', 'demo-student'].includes(snapshot.userId || '')
      || (Array.isArray(snapshot.tasks) && snapshot.tasks.some(task => task?.demo_seed || (typeof task?.task_id === 'string' && task.task_id.startsWith('demo-'))));
    if (!isDemoMode && user?.uid && fromDemo) {
      throw new Error('Demo backups contain sample data and cannot be restored into a real account. Open Explore Demo Data to view this backup.');
    }
    if (snapshot.userId !== currentUserId && !(isDemoMode && fromDemo)) {
      const source = snapshot.userId ? 'a different account' : 'an unknown account (this older backup has no owner)';
      if (!window.confirm(`This backup belongs to ${source}. Restore its data into the current ${isDemoMode ? 'demo workspace' : 'account'}?`)) {
        throw new Error('Restore cancelled. No data was changed.');
      }
    }
    if (mode === 'replace' && (!snapshot.tasks || snapshot.tasks.length === 0)) {
      throw new Error('This backup has no tasks, so Replace would delete everything. Use Merge instead, or pick another file.');
    }

    // Sanitize imported preferences so external calendar feed tokens and personal emails are never adopted
    const sanitizedPrefs = sanitizeNotificationPrefsForImport(snapshot.notificationPrefs, notificationPrefs);
    const safeSnapshot = normalizeBackupSnapshot({
      ...snapshot,
      notificationPrefs: sanitizedPrefs,
      // Real-account collections are normalized per item by the restore service,
      // so a malformed schedule entry cannot prevent later entries from saving.
      ...(!isDemoMode && user?.uid ? { tasks: [], courses: [], classes: [], exams: [] } : {})
    });

    if (isDemoMode || !user?.uid) {
      if (mode === 'replace') {
        setTasks(safeSnapshot.tasks || []);
        setCourses(safeSnapshot.courses || []);
        setClasses(safeSnapshot.classes || []);
        setExams(safeSnapshot.exams || []);
      } else {
        setTasks(prev => mergeById(prev, safeSnapshot.tasks || [], task => task.task_id));
        setCourses(prev => mergeById(prev, safeSnapshot.courses || [], course => course.id));
        setClasses(prev => mergeById(prev, safeSnapshot.classes || [], item => item.id));
        setExams(prev => mergeById(prev, safeSnapshot.exams || [], item => item.id));
      }
      if (sanitizedPrefs) {
        notificationPrefsRef.current = sanitizedPrefs;
        setNotificationPrefs(sanitizedPrefs);
      }
      if (safeSnapshot.uiPrefs) {
        setUiPrefs(safeSnapshot.uiPrefs);
      }
      return {
        tasksRestored: safeSnapshot.tasks?.length || 0,
        coursesRestored: safeSnapshot.courses?.length || 0,
        classesRestored: safeSnapshot.classes?.length || 0,
        examsRestored: safeSnapshot.exams?.length || 0
      };
    }

    const result = await restoreDashboardBackup(user.uid, {
      ...safeSnapshot, tasks: snapshot.tasks, courses: snapshot.courses,
      classes: snapshot.classes, exams: snapshot.exams
    }, mode);
    if (sanitizedPrefs) {
      notificationPrefsRef.current = sanitizedPrefs;
      setNotificationPrefs(sanitizedPrefs);
    }
    await refreshTasks();
    return result;
  };

  const importFullBackup = async (
    backup: any,
    mode: 'merge' | 'replace' = 'merge'
  ) => {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('Invalid backup file.');
    const rawData = backup.data || backup;
    const sanitizedPrefs = sanitizeNotificationPrefsForImport(rawData.notificationPrefs, notificationPrefs);
    const snapshot: DashboardBackupSnapshot = {
      version: backup.version || '2.0',
      exportedAt: backup.exportedAt || new Date().toISOString(),
      userId: backup.userId || rawData.userId,
      isDemo: backup.isDemo === true || rawData.isDemo === true,
      tasks: rawData.tasks || [],
      courses: rawData.courses || [],
      classes: rawData.classes || [],
      exams: rawData.exams || [],
      notificationPrefs: sanitizedPrefs,
      uiPrefs: rawData.uiPrefs
    };
    return await restoreFullBackup(snapshot, mode);
  };

  const downloadFullBackup = async () => {
    const snapshot = await exportFullBackup();
    if ((!snapshot.tasks || snapshot.tasks.length === 0) && tasks.length > 0) {
      throw new Error('The export came back empty; try again in a moment.');
    }

    const backupData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      userId: snapshot.userId,
      isDemo: snapshot.isDemo === true,
      data: {
        tasks: snapshot.tasks,
        courses: snapshot.courses,
        classes: snapshot.classes,
        exams: snapshot.exams,
        notificationPrefs: snapshot.notificationPrefs,
        uiPrefs: snapshot.uiPrefs
      }
    };
    const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const vancouverDate = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const fileName = `My_LMS_Backup_${vancouverDate}.json`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { fileName };
  };

  const getLatestCheckpoint = () => {
    const checkpoint = checkpointRef.current;
    return checkpoint?.userId === currentUserId && !isDemoMode ? checkpoint : null;
  };

  const restoreFromCheckpoint = async (): Promise<boolean> => {
    const cp = getLatestCheckpoint();
    if (!cp || !cp.tasks) return false;
    await restoreFullBackup({
      version: '2.0',
      exportedAt: cp.exportedAt || cp.timestamp || new Date().toISOString(),
      userId: cp.userId,
      tasks: cp.tasks || [],
      courses: cp.courses || [],
      classes: cp.classes || [],
      exams: cp.exams || []
    }, 'merge');
    return true;
  };

  const exportToCSV = () => {
    const courseworkTasks = tasks.filter(t => !isTaskAnnouncement(t));
    if (courseworkTasks.length === 0) {
      showToast({ message: 'Nothing to export yet — add tasks manually or upload a course outline first.' });
      return null;
    }
    const headers = [
      'Task ID', 'Course', 'Title', 'Type', 'Due Date', 'Status',
      'Points Earned', 'Points Possible', 'Grade', 'Next Action',
      'Summary', 'Progress Notes'
    ];

    const escapeCsvCell = (val: string | number | undefined | null) => {
      const str = val == null ? '' : String(val);
      // Formula-injection guard: cells beginning with =, +, -, @, \t, \r are prefixed with '
      const safe = /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    const rows = courseworkTasks.map(t => [
      escapeCsvCell(t.task_id),
      escapeCsvCell(t.course),
      escapeCsvCell(t.title),
      escapeCsvCell(t.type),
      escapeCsvCell(t.due_at),
      escapeCsvCell(t.status || 'Not Started'),
      escapeCsvCell(t.points_earned),
      escapeCsvCell(t.points_possible),
      escapeCsvCell(t.grade_text),
      escapeCsvCell(t.next_action),
      escapeCsvCell(t.summary),
      escapeCsvCell(t.progress_notes)
    ]);

    const csvContent = [headers.map(h => `"${h}"`).join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const vancouverDate = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const fileName = `My_LMS_Tasks_${vancouverDate}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast({ message: `Downloading tasks.csv (${courseworkTasks.length} ${courseworkTasks.length === 1 ? 'task' : 'tasks'})` });
    return { fileName, taskCount: courseworkTasks.length };
  };

  const enableDemoMode = () => {
    setActiveFocus(null);
    persistFocusTimerTransition(null);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('ubc_active_focus_timer');
        localStorage.removeItem('ubc_active_focus_timer_demo-student');
        localStorage.removeItem('ubc_active_focus_timer_demo_student');
      } catch (e) {
        console.warn('Error clearing focus timer on demo entry:', e);
      }
    }
    notificationsRef.current = [];
    setNotificationsState([]);
    hasSeededDemoRef.current = true;
    setIsDemoMode(true);
    demoTasksBaselineRef.current = getDemoTasks();
    setTasks(demoTasksBaselineRef.current);
    demoCoursesBaselineRef.current = FICTIONAL_SAMPLE_COURSES.map(course => ({ ...course, ...getDemoTerm() }));
    setCourses(demoCoursesBaselineRef.current);
    setClasses(DEMO_CLASSES);
    demoExamsBaselineRef.current = getDemoExams();
    setExams(demoExamsBaselineRef.current);
    setGroups(DEMO_GROUPS);
    setActiveGroupId(DEMO_GROUPS.length > 0 ? DEMO_GROUPS[0].id : null);
    setLastSync(null);
    setError(null);
    setWriteError(null);
  };

  const [showExitDemoConfirm, setShowExitDemoConfirm] = useState(false);
  const [savingDemo, setSavingDemo] = useState(false);
  const [demoSaveError, setDemoSaveError] = useState<string | null>(null);
  const { modalRef: exitDemoModalRef } = useModalFocus({
    isOpen: showExitDemoConfirm,
    onClose: () => { if (!savingDemo) setShowExitDemoConfirm(false); }
  });

  const keepDemoEntries = async () => {
    if (savingDemo) return;
    setSavingDemo(true);
    setDemoSaveError(null);
    try {
      // Keep student edits without copying the untouched fictional sample dataset.
      const changed = <T,>(items: T[], samples: T[], getId: (item: T) => string): T[] => items.filter(item => {
        const sample = samples.find(candidate => getId(candidate) === getId(item));
        return !sample || JSON.stringify(item) !== JSON.stringify(sample);
      });
      const snapshot = normalizeBackupSnapshot({
        version: '2.0', exportedAt: new Date().toISOString(),
        tasks: changed(tasks, demoTasksBaselineRef.current, task => task.task_id).map(task => {
          const { demo_seed, ...entry } = task;
          return { ...entry, task_id: task.task_id.startsWith('demo-') ? `task-${crypto.randomUUID()}` : task.task_id };
        }),
        courses: changed(courses, demoCoursesBaselineRef.current, course => course.id),
        classes: changed(classes, DEMO_CLASSES, item => item.id),
        exams: changed(exams, demoExamsBaselineRef.current, item => item.id)
      });
      const signedIn = auth.currentUser || await googleSignIn();
      if (!signedIn) throw new Error('Sign-in did not finish. Your demo entries are still here.');
      await restoreDashboardBackup(signedIn.uid, { ...snapshot, userId: signedIn.uid }, 'merge');
      await confirmExitDemo(signedIn);
      showToast({ message: 'Your added and edited entries were saved to your account.' });
    } catch (err: any) {
      setDemoSaveError(err?.message || 'Could not save your entries. Stay in demo and try again.');
    } finally {
      setSavingDemo(false);
    }
  };

  const confirmExitDemo = async (signedIn?: AppUser) => {
    setShowExitDemoConfirm(false);
    endingSessionRef.current = true;
    checkpointRef.current = null;
    setTasks([]);
    setCourses([]);
    setClasses([]);
    setExams([]);
    setActiveFocus(null);
    persistFocusTimerTransition(null);
    notificationsRef.current = [];
    setNotificationsState([]);
    // Remove only demo storage; exploring sample data must preserve the real account.
    try {
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => !!key && (key.endsWith('_demo_student') || key.endsWith('_demo-student')))
        .forEach(key => localStorage.removeItem(key));
      localStorage.removeItem('ubc_active_focus_timer');
      clearFiredHistory('demo_student');
      clearFiredHistory('demo-student');
    } catch (e) {
      console.warn('Error clearing demo storage:', e);
    }
    setGroups([]);
    setGroupTasks([]);
    setActiveGroupId(null);
    setError(null);
    setWriteError(null);
    if (!signedIn && (!user?.uid || ['demo-student', 'demo_student'].includes(user.uid))) {
      try { await firebaseLogout(currentUserId); } catch (e) {
        console.warn('Error clearing demo session:', e);
      }
      onLogoutRef.current();
      return;
    }
    endingSessionRef.current = false;
    setLoading(true);
    setIsDemoMode(false);
    if (signedIn) onDemoSignIn?.(signedIn);
  };

  const disableDemoMode = (force: boolean = false) => {
    if (savingDemo) return;
    if (force) {
      confirmExitDemo();
      return;
    }
    setDemoSaveError(null);
    setShowExitDemoConfirm(true);
  };

  const handleLogout = async () => {
    if (endingSessionRef.current) return;
    endingSessionRef.current = true;
    checkpointRef.current = null;
    try {
      setActiveFocus(null);
      persistFocusTimerTransition(null);
      setTasks([]);
      setCourses([]);
      setClasses([]);
      setExams([]);
      setGroups([]);
      setGroupTasks([]);
      setActiveGroupId(null);
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (
              key.startsWith('ubc_') ||
              key.includes('checkpoint') ||
              key.includes('notification') ||
              key.includes('demo') ||
              (currentUserId && key.includes(currentUserId)) ||
              (user?.uid && key.includes(user.uid))
            ) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (storageErr) {
          console.warn('Error clearing local storage on logout:', storageErr);
        }
      }

      await firebaseLogout(currentUserId);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      onLogoutRef.current();
    }
  };

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importInitialTab, setImportInitialTab] = useState<ImportTabType>('file');

  const openImport = useCallback((tab?: ImportTabType) => {
    if (tab) {
      setImportInitialTab(tab === 'calendar' ? 'file' : tab);
    }
    setIsImportOpen(true);
  }, []);

  const closeImport = useCallback(() => {
    setIsImportOpen(false);
  }, []);

  const updateCourse = async (course: Course) => {
    if (course.credits != null && (!Number.isFinite(course.credits) || course.credits < 0 || course.credits > 30)) {
      throw new Error('Course credits must be between 0 and 30.');
    }
    const existingCourse = courses.find(c => c.id === course.id || normalizeCourseCode(c.course_code) === normalizeCourseCode(course.course_code));
    const saved = normalizeCourse(cleanForFirestore({ ...course,
      id: existingCourse?.id ?? (course.id.startsWith('auto-') ? `course-${normalizeCourseCode(course.course_code).toLowerCase()}` : course.id)
    }), course.id);
    if (!isDemoMode) {
      if (!user?.uid) throw new Error('You must be signed in to save courses.');
      if (['course-1', 'course-2', 'course-3'].includes(course.id) || /^(sample-|fictional-)/.test(course.id)) {
        throw new Error('Sample courses cannot be saved to a real account.');
      }
      await saveFirestoreCourse(user.uid, saved);
    }
    if (endingSessionRef.current) return;
    setCourses(prev => {
      const existing = prev.find(c => c.id === saved.id || normalizeCourseCode(c.course_code) === normalizeCourseCode(saved.course_code));
      return existing ? prev.map(c => c.id === existing.id ? { ...saved, id: existing.id } : c) : [...prev, saved];
    });
  };

  const deleteCourse = async (courseId: string) => {
    if (!isDemoMode) {
      if (!user?.uid) throw new Error('You must be signed in to delete courses.');
      await deleteFirestoreCourse(user.uid, courseId);
    }
    if (!endingSessionRef.current) setCourses(prev => prev.filter(c => c.id !== courseId));
  };

  const contextValue = useMemo<TaskContextType>(() => ({
      uiPrefs,
      setViewMode: setViewModeHandler,
      updateUiPrefs: updateUiPrefsHandler,
      focusModeActive,
      isFocusModeActive: focusModeActive,
      setFocusModeActive,
      // Import modal
      openImport,
      isImportOpen,
      importInitialTab,
      closeImport,
      // Toast notifications
      toast,
      showToast,
      dismissToast,
      now,
      tasks,
      courses,
      updateCourse,
      deleteCourse,
      classes,
      exams,
      groups,
      activeGroupId,
      setActiveGroupId,
      groupTasks,
      loading,
      error: writeError || error,
      lastSync,
      isOnline,
      hasPendingWrites,
      isDemoMode,
      notificationPrefs,
      notifications,
      unreadNotificationCount,
      updateNotificationPrefs: updatePrefsHandler,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      clearNotification,
      clearAllNotifications,
      triggerTestReminder,
      triggerDigest,
      clearReminderHistory: clearReminderHistoryHandler,
      enableDemoMode,
      disableDemoMode,
      refreshTasks,
      updateTask,
      addTask,
      batchAddTasks,
      deleteTask,
      dismissReviewTasks,
      addClassItem,
      updateClassItem,
      deleteClassItem,
      addExamItem,
      updateExamItem,
      deleteExamItem,
      // Focus Timer operations
      activeFocus,
      startFocusTimer,
      pauseFocusTimer,
      resumeFocusTimer,
      resetFocusTimer,
      stopAndLogFocusTimer,
      logManualFocusTime,
      // Group Workspace operations
      createGroup,
      joinGroupByCode,
      leaveGroup,
      saveGroupTaskAction,
      deleteGroupTaskAction,
      // Data protection and backup
      exportFullBackup,
      downloadFullBackup,
      restoreFullBackup,
      importFullBackup,
      getLatestCheckpoint,
      restoreFromCheckpoint,
      exportToCSV,
      logout: handleLogout
    }), [uiPrefs, focusModeActive, isImportOpen, importInitialTab, toast, now, tasks, courses,
      classes, exams, groups, activeGroupId, groupTasks, loading, error, writeError, lastSync,
      isOnline, hasPendingWrites, isDemoMode, notificationPrefs, notifications,
      unreadNotificationCount, activeFocus, currentUserId, user, onLogout]);

  return (
    <TaskContext.Provider value={contextValue}>
      <FocusClockProvider activeFocus={activeFocus}>{children}</FocusClockProvider>
      {showExitDemoConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-demo-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div ref={exitDemoModalRef} tabIndex={-1} className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded-xl shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 id="leave-demo-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
                  Leave demo
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Leaving the demo deletes everything you've entered — demo data is never saved.
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Sign in to save your added or edited tasks, courses, classes and exams. Unchanged samples and demo groups are excluded.
                </p>
              </div>
            </div>

            {demoSaveError && <p role="alert" className="text-sm text-red-600">{demoSaveError}</p>}
            <div className="flex flex-col items-stretch gap-2 pt-2" aria-busy={savingDemo}>
              <button type="button" onClick={keepDemoEntries} disabled={savingDemo}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
                {savingDemo ? 'Saving your entries…' : 'Sign in to keep this data'}
              </button>
              <button
                type="button"
                id="leave-demo-export-csv-btn"
                disabled={savingDemo}
                onClick={() => {
                  exportToCSV();
                }}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                Export CSV first
              </button>
              <button
                type="button"
                id="leave-demo-confirm-btn"
                disabled={savingDemo}
                onClick={() => confirmExitDemo()}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer"
              >
                Leave anyway
              </button>
              <button
                type="button"
                id="leave-demo-stay-btn"
                disabled={savingDemo}
                onClick={() => setShowExitDemoConfirm(false)}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </TaskContext.Provider>
  );
}
