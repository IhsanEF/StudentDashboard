import { Task, NotificationPrefs, InAppNotification, DEFAULT_NOTIFICATION_PREFS } from '../types';
import { formatInTimeZone, toDate, TIMEZONE, parseLocalDate, isTaskAnnouncement, isDateOnly, isTaskDueToday } from '../utils';

// Helper to check if current Vancouver time is within quiet hours
export function isQuietHoursActive(quietHours: NotificationPrefs['quietHours'], now: Date = new Date()): boolean {
  if (!quietHours?.enabled) return false;
  
  try {
    const vancouverTimeStr = formatInTimeZone(now, TIMEZONE, 'HH:mm');
    const [currH, currM] = vancouverTimeStr.split(':').map(Number);
    const currentMinutes = currH * 60 + currM;

    const [startH, startM] = (quietHours.start || '23:00').split(':').map(Number);
    const [endH, endM] = (quietHours.end || '08:00').split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight (e.g. 23:00 to 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch (err) {
    console.warn('Error checking quiet hours:', err);
    return false;
  }
}

// Helper to calculate the exact Date when the current quiet-hours period ends (in Vancouver time)
export function getQuietHoursEnd(quietHours: NotificationPrefs['quietHours'], now: Date = new Date()): Date {
  const [startH, startM] = (quietHours?.start || '23:00').split(':').map(Number);
  const [endH, endM] = (quietHours?.end || '08:00').split(':').map(Number);
  
  const vancouverTimeStr = formatInTimeZone(now, TIMEZONE, 'HH:mm');
  const [currH, currM] = vancouverTimeStr.split(':').map(Number);
  const currentMinutes = currH * 60 + currM;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const todayStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  let endDateStr = todayStr;

  if (startMinutes > endMinutes) {
    // Overnight (e.g. 23:00 to 08:00)
    // If current time is after start time (e.g. 23:30), quiet hours ends tomorrow morning
    if (currentMinutes >= startMinutes) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      endDateStr = formatInTimeZone(tomorrow, TIMEZONE, 'yyyy-MM-dd');
    } else {
      // Current time is after midnight (e.g. 02:00), quiet hours ends today at endMinutes
      endDateStr = todayStr;
    }
  } else {
    // Daytime quiet hours (e.g. 13:00 to 15:00)
    endDateStr = todayStr;
  }

  const endHStr = String(endH).padStart(2, '0');
  const endMStr = String(endM).padStart(2, '0');
  return toDate(`${endDateStr}T${endHStr}:${endMStr}:00`, { timeZone: TIMEZONE });
}

// Format lead minutes to human friendly text
export function formatLeadTimeText(minutes: number): string {
  if (minutes >= 10080) return `${Math.round(minutes / 10080)} week${minutes >= 20160 ? 's' : ''}`;
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} day${minutes >= 2880 ? 's' : ''}`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} hour${minutes >= 120 ? 's' : ''}`;
  return `${minutes} minutes`;
}

// Helper to calculate calendar day diff in America/Vancouver (V3-042)
export function getCalendarDayDiff(now: Date, dueDate: Date): number {
  const todayStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const dueStr = formatInTimeZone(dueDate, TIMEZONE, 'yyyy-MM-dd');
  const [y1, m1, d1] = todayStr.split('-').map(Number);
  const [y2, m2, d2] = dueStr.split('-').map(Number);
  const date1Utc = Date.UTC(y1, m1 - 1, d1);
  const date2Utc = Date.UTC(y2, m2 - 1, d2);
  return Math.round((date2Utc - date1Utc) / 86400000);
}

// Format actual real remaining time rather than static configured lead (V3-033, V3-042, V3-047)
export function formatRealRemainingTimeText(
  diffMinutes: number, 
  isDateOnlyTask: boolean, 
  dueDate: Date, 
  now: Date
): { text: string; timeSuffix: string } {
  if (isDateOnlyTask) {
    const calDays = getCalendarDayDiff(now, dueDate);
    const dateFormatted = formatInTimeZone(dueDate, TIMEZONE, 'EEEE, MMM d');
    if (calDays <= 0) {
      return { text: 'Due today', timeSuffix: `(${dateFormatted})` };
    }
    if (calDays === 1) {
      return { text: 'Due tomorrow', timeSuffix: `(${dateFormatted})` };
    }
    return { text: `Due in ${calDays} days`, timeSuffix: `(${dateFormatted})` };
  }

  const dateFormatted = formatInTimeZone(dueDate, TIMEZONE, 'h:mm a (EEEE, MMM d)');
  if (diffMinutes < 60) {
    const mins = Math.max(1, diffMinutes);
    return { text: `Due in ${mins} minute${mins === 1 ? '' : 's'}`, timeSuffix: `at ${dateFormatted}` };
  }
  if (diffMinutes < 1440) {
    const hrs = Math.floor(diffMinutes / 60);
    const remMins = diffMinutes % 60;
    const hrsText = remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs} hour${hrs === 1 ? '' : 's'}`;
    return { text: `Due in ${hrsText}`, timeSuffix: `at ${dateFormatted}` };
  }
  const days = Math.round((diffMinutes / 1440) * 10) / 10;
  return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, timeSuffix: `at ${dateFormatted}` };
}

// Deferred reminder record structure
export interface DeferredReminder {
  reminderKey: string;
  taskId: string;
  leadMin: number;
  deferredUntil: number; // timestamp in ms of quiet-hours end
}

function getDeferredStorageKey(userId: string): string {
  return `ubc_deferred_reminders_${userId || 'guest'}`;
}

export function getDeferredReminders(userId: string): Record<string, DeferredReminder> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getDeferredStorageKey(userId));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to parse deferred reminders:', e);
  }
  return {};
}

export function saveDeferredReminders(userId: string, deferred: Record<string, DeferredReminder>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getDeferredStorageKey(userId), JSON.stringify(deferred));
  } catch (e) {
    console.warn('Failed to save deferred reminders:', e);
  }
}

export function clearDeferredReminders(userId: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(getDeferredStorageKey(userId));
  } catch (e) {
    console.warn('Failed to clear deferred reminders:', e);
  }
}

// Storage helpers for fired notifications to prevent duplicate alerts across tabs & refreshes
function getStorageKey(userId: string): string {
  return `ubc_fired_reminders_${userId || 'guest'}`;
}

function getNotificationsStorageKey(userId: string): string {
  return `ubc_inapp_notifications_${userId || 'guest'}`;
}

export function loadSavedNotifications(userId: string): InAppNotification[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getNotificationsStorageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load saved notifications:', e);
  }
  return [];
}

export function saveNotificationsToStorage(userId: string, notifications: InAppNotification[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    // Keep max 50 recent notifications
    const trimmed = [...new Map(notifications.map(n => [n.id, n])).values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
    localStorage.setItem(getNotificationsStorageKey(userId), JSON.stringify(trimmed));
    return true;
  } catch (e) {
    console.warn('Failed to save notifications to storage:', e);
    return false;
  }
}

// Read fresh storage for every operation so a stale tab cannot overwrite another tab's additions.
export function updateSavedNotifications(
  userId: string,
  update: (current: InAppNotification[]) => InAppNotification[],
  fallback: InAppNotification[] = []
): InAppNotification[] {
  const current = typeof localStorage === 'undefined' ? fallback : loadSavedNotifications(userId);
  const next = [...new Map(update(current).map(n => [n.id, n])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  saveNotificationsToStorage(userId, next);
  return next;
}

function persistReminder(userId: string, notification: InAppNotification, keys: string[], inApp: boolean): boolean {
  if (inApp) {
    const notifications = [notification, ...loadSavedNotifications(userId)];
    if (!saveNotificationsToStorage(userId, notifications)) return false;
  }
  if (typeof localStorage === 'undefined') return false;
  try {
    const fired = getFiredReminderKeys(userId);
    keys.forEach(key => { fired[key] = new Date(notification.createdAt).getTime(); });
    localStorage.setItem(getStorageKey(userId), JSON.stringify(fired));
    return true;
  } catch (e) {
    console.warn('Failed to record fired reminders:', e);
    return false;
  }
}

export function getFiredReminderKeys(userId: string): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to parse fired reminder keys:', e);
  }
  return {};
}

export function markReminderFired(userId: string, reminderKey: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    const current = getFiredReminderKeys(userId);
    current[reminderKey] = Date.now();
    localStorage.setItem(getStorageKey(userId), JSON.stringify(current));
  } catch (e) {
    console.warn('Failed to record fired reminder key:', e);
  }
}

export function clearFiredHistory(userId: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(getStorageKey(userId));
    localStorage.removeItem(getDeferredStorageKey(userId));
  } catch (e) {
    console.warn('Failed to clear reminder history:', e);
  }
}

function pruneFiredReminderKeys(userId: string, tasks: Task[], leadTimes: number[], now: Date): Record<string, number> {
  const fired = getFiredReminderKeys(userId);
  const oldest = now.getTime() - (Math.max(0, ...leadTimes) + 1440) * 60000;
  const taskIds = new Set(tasks.map(task => task.task_id));
  let changed = false;
  for (const [key, timestamp] of Object.entries(fired)) {
    const reminder = /^remind_(.*)_\d+$/.exec(key);
    if (!Number.isFinite(timestamp) || timestamp < oldest || (reminder && !taskIds.has(reminder[1]))) {
      delete fired[key];
      changed = true;
    }
  }
  if (changed && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(getStorageKey(userId), JSON.stringify(fired));
    } catch (e) {
      console.warn('Failed to prune fired reminders:', e);
    }
  }
  return fired;
}

// Count deliveries from durable fired history, independently of dismissed bell items.
function getDailyNotificationCount(fired: Record<string, number>, now: Date): number {
  const todayVancouver = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const deliveries = new Set<string>();
  for (const [key, timestamp] of Object.entries(fired)) {
    const reminder = /^remind_(.*)_\d+$/.exec(key);
    if (reminder && Number.isFinite(timestamp) && formatInTimeZone(new Date(timestamp), TIMEZONE, 'yyyy-MM-dd') === todayVancouver) {
      // Multiple crossed leads marked by one delivery share a task and timestamp.
      deliveries.add(`${reminder[1]}_${timestamp}`);
    }
  }
  return deliveries.size;
}

export type BrowserNotificationStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export function getBrowserNotificationPermission(): BrowserNotificationStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as BrowserNotificationStatus;
}

export interface BrowserNotificationOptions {
  tag?: string;
  taskId?: string;
  leadMin?: number;
  onClick?: () => void;
}

// Trigger native browser notification via Service Worker (Android Chrome safe) or window fallback (V3-045)
export async function showBrowserNotification(
  title: string, 
  body: string, 
  options: BrowserNotificationOptions | (() => void) = {}
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const opts: BrowserNotificationOptions = typeof options === 'function' ? { onClick: options } : options;
  const tag = opts.tag || (opts.taskId ? `ubc-task-${opts.taskId}-${opts.leadMin || 'remind'}` : `ubc-notif-${Date.now()}`);

  const notifOptions: NotificationOptions = {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag
  };

  // 1. Try Service Worker showNotification first (Android Chrome requirement, prevents 'Illegal constructor')
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, notifOptions);
        return;
      }
    } catch (swErr) {
      // Fall through to Notification constructor
    }
  }

  // 2. Desktop Notification constructor fallback
  try {
    const notification = new Notification(title, notifOptions);
    if (opts.onClick) {
      notification.onclick = () => {
        window.focus();
        opts.onClick?.();
        notification.close();
      };
    }
  } catch (e) {
    console.warn('Native browser notification failed:', e);
  }
}

// Main evaluation function
export function evaluateNotifications({
  tasks,
  prefs,
  userId,
  currentNotifications,
  now = new Date(),
  sessionStartedAt,
  firstEvaluation = false
}: {
  tasks: Task[];
  prefs: NotificationPrefs;
  userId: string;
  currentNotifications: InAppNotification[];
  now?: Date;
  sessionStartedAt?: number;
  firstEvaluation?: boolean;
}): { newNotifications: InAppNotification[]; updatedPrefs?: Partial<NotificationPrefs> } {
  // If master toggle is off or in-app channel is off (and no browser/email), do nothing
  if (!prefs.enabled) {
    return { newNotifications: [] };
  }

  const anyChannelActive = prefs.channels.inApp || prefs.channels.push || prefs.channels.email;
  if (!anyChannelActive) {
    return { newNotifications: [] };
  }

  // Respect quiet hours (Vancouver time)
  const firedKeys = pruneFiredReminderKeys(userId, tasks, prefs.leadTimes || [], now);
  const deferredMap = getDeferredReminders(userId);
  const dailyCount = getDailyNotificationCount(firedKeys, now);
  const maxPerDay = prefs.maxPerDay ?? 5;

  let remainingDailySlots = Math.max(0, maxPerDay - dailyCount);
  if (firstEvaluation) remainingDailySlots = Math.min(1, remainingDailySlots);
  const newlyCreated: InAppNotification[] = [];

  const nowMs = now.getTime();
  const todayVancouverStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const dayOfWeekVancouver = parseInt(formatInTimeZone(now, TIMEZONE, 'i'), 10); // 1 = Monday, 7 = Sunday
  const hourVancouver = parseInt(formatInTimeZone(now, TIMEZONE, 'H'), 10);
  const minuteVancouver = parseInt(formatInTimeZone(now, TIMEZONE, 'm'), 10);

  // 1. Process Pending Deferred Reminders sorted by deadline urgency (V3-048)
  let deferredChanged = false;
  if (Object.keys(deferredMap).length > 0) {
    interface DeferredCandidate {
      reminderKey: string;
      item: DeferredReminder;
      task: Task;
      dueDate: Date;
      diffMs: number;
    }

    const readyDeferred: DeferredCandidate[] = [];

    for (const [reminderKey, item] of Object.entries(deferredMap)) {
      if (firedKeys[reminderKey]) {
        delete deferredMap[reminderKey];
        deferredChanged = true;
        continue;
      }

      // If quiet hours has not ended yet for this deferred reminder
      if (nowMs < item.deferredUntil) {
        continue;
      }
      if (!firstEvaluation && sessionStartedAt && item.deferredUntil < sessionStartedAt) continue;

      // Quiet hours has ended! Check if task still exists and is still upcoming
      const task = tasks.find(t => t.task_id === item.taskId);
      if (!task || task.status === 'Done' || task.status === 'Submitted' || isTaskAnnouncement(task) || !task.due_at) {
        delete deferredMap[reminderKey];
        deferredChanged = true;
        continue;
      }

      const dueDate = parseLocalDate(task.due_at);
      if (!dueDate || dueDate.getTime() <= nowMs) {
        // Deadline has already passed!
        delete deferredMap[reminderKey];
        deferredChanged = true;
        continue;
      }

      readyDeferred.push({
        reminderKey,
        item,
        task,
        dueDate,
        diffMs: dueDate.getTime() - nowMs
      });
    }

    // Sort deferred reminders by urgency (soonest deadline first) (V3-048)
    readyDeferred.sort((a, b) => a.diffMs - b.diffMs);

    for (const def of readyDeferred) {
      if (remainingDailySlots <= 0) break;

      const isDateOnlyTask = isDateOnly(def.task.due_at);
      const diffMinutes = Math.max(1, Math.floor(def.diffMs / 60000));
      const { text: remainingText, timeSuffix } = formatRealRemainingTimeText(
        diffMinutes, 
        isDateOnlyTask, 
        def.dueDate, 
        now
      );
      
      const notifTitle = `⏰ ${def.task.course || 'Course'} Deadline: ${def.task.title}`;
      const notifBody = `${remainingText} ${timeSuffix}. Tap to review details.`;

      const newNotif: InAppNotification = {
        id: `notif_${def.reminderKey}`,
        taskId: def.task.task_id,
        taskTitle: def.task.title,
        courseCode: def.task.course,
        dueAt: def.task.due_at,
        leadMinutes: def.item.leadMin,
        type: 'reminder',
        title: notifTitle,
        body: notifBody,
        createdAt: now.toISOString(),
        read: false
      };

      const crossedKeys = (prefs.leadTimes || []).filter(lead => lead >= def.item.leadMin)
        .map(lead => `remind_${def.task.task_id}_${lead}`);
      persistReminder(userId, newNotif, [...crossedKeys, def.reminderKey], prefs.channels.inApp);
      [...crossedKeys, def.reminderKey].forEach(key => { firedKeys[key] = nowMs; });
      delete deferredMap[def.reminderKey];
      deferredChanged = true;
      if (prefs.channels.inApp) newlyCreated.push(newNotif);
      remainingDailySlots--;

      if (prefs.channels.push) {
        showBrowserNotification(notifTitle, notifBody, {
          taskId: def.task.task_id,
          leadMin: def.item.leadMin
        });
      }
    }

    if (deferredChanged) {
      saveDeferredReminders(userId, deferredMap);
    }
  }

  // 2. Evaluate Task Reminders: build all candidate pairs, sort by urgency, then apply cap (V3-047, V3-048)
  if (prefs.leadTimes && prefs.leadTimes.length > 0) {
    // Sort leads ascending to prioritize the smallest eligible lead (V3-033, V3-047)
    const sortedLeads = [...prefs.leadTimes].sort((a, b) => a - b);

    interface ReminderCandidate {
      task: Task;
      dueDate: Date;
      diffMs: number;
      diffMinutes: number;
      isDateOnlyTask: boolean;
      selectedLead: number;
      reminderKey: string;
      crossedKeys: string[];
    }

    const readyCandidates: ReminderCandidate[] = [];

    for (const task of tasks) {
      // Ignore completed, submitted, or announcement items
      if (task.status === 'Done' || task.status === 'Submitted' || isTaskAnnouncement(task)) {
        continue;
      }

      if (!task.due_at) continue;

      const dueDate = parseLocalDate(task.due_at);
      if (!dueDate) continue;

      const dueMs = dueDate.getTime();
      const diffMs = dueMs - nowMs;

      // Ignore tasks already in the past
      if (diffMs <= 0) continue;

      const diffMinutes = Math.floor(diffMs / (60 * 1000));
      const isDateOnlyTask = isDateOnly(task.due_at);

      // Collect all leads whose threshold has been crossed (V3-033, V3-042, V3-047)
      const crossedLeads: number[] = [];
      for (const leadMin of sortedLeads) {
        const reminderKey = `remind_${task.task_id}_${leadMin}`;
        if (firedKeys[reminderKey] || deferredMap[reminderKey]) continue;
        if (Object.values(deferredMap).some(item => item.taskId === task.task_id && item.leadMin <= leadMin)) continue;

        let isCrossed = false;
        if (isDateOnlyTask) {
          // Date-only tasks anchored to calendar day difference (V3-042)
          const calDays = getCalendarDayDiff(now, dueDate);
          if (calDays < 0) continue;
          const leadDays = Math.ceil(leadMin / 1440);
          isCrossed = calDays <= leadDays;
        } else {
          isCrossed = diffMinutes <= leadMin;
        }

        if (isCrossed) {
          // On entry allow one catch-up reminder. Later evaluations only deliver new thresholds.
          const threshold = isDateOnlyTask
            ? dueMs - Math.ceil(leadMin / 1440) * 86400000
            : dueMs - leadMin * 60000;
          if (!firstEvaluation && sessionStartedAt && threshold < sessionStartedAt) continue;
          crossedLeads.push(leadMin);
        }
      }

      if (crossedLeads.length === 0) continue;

      // Fire ONLY the smallest crossed lead (V3-033, V3-047)
      const selectedLead = crossedLeads[0];
      const reminderKey = `remind_${task.task_id}_${selectedLead}`;

      // Record all crossed keys only after their notification has been persisted.
      const crossedKeys = crossedLeads.map(lead => `remind_${task.task_id}_${lead}`);

      // Check quiet hours and same-night exemption:
      // If the deadline itself falls inside quiet hours, 1-hour (60 min) and 15-minute reminders are not suppressed
      const inQuietHours = isQuietHoursActive(prefs.quietHours, now);
      const deadlineInQuietHours = isQuietHoursActive(prefs.quietHours, dueDate);
      const isSameNightExempt = deadlineInQuietHours && (selectedLead === 60 || selectedLead === 15);

      if (inQuietHours && !isSameNightExempt) {
        const deferredUntil = getQuietHoursEnd(prefs.quietHours, now).getTime();
        deferredMap[reminderKey] = {
          reminderKey,
          taskId: task.task_id,
          leadMin: selectedLead,
          deferredUntil
        };
        saveDeferredReminders(userId, deferredMap);
        continue;
      }

      readyCandidates.push({
        task,
        dueDate,
        diffMs,
        diffMinutes,
        isDateOnlyTask,
        selectedLead,
        reminderKey,
        crossedKeys
      });
    }

    // Sort candidate reminders by remaining time to the deadline (most urgent first) (V3-048)
    readyCandidates.sort((a, b) => a.diffMs - b.diffMs);

    // Apply the daily cap in urgency order so midterms are never starved by readings (V3-048)
    for (const cand of readyCandidates) {
      if (remainingDailySlots <= 0) break;

      // Compute body text from the actual remaining time (V3-033, V3-042, V3-047)
      const { text: remainingText, timeSuffix } = formatRealRemainingTimeText(
        cand.diffMinutes, 
        cand.isDateOnlyTask, 
        cand.dueDate, 
        now
      );
      
      const notifTitle = `⏰ ${cand.task.course || 'Course'} Deadline: ${cand.task.title}`;
      const notifBody = `${remainingText} ${timeSuffix}. Tap to review details.`;

      const newNotif: InAppNotification = {
        id: `notif_${cand.reminderKey}`,
        taskId: cand.task.task_id,
        taskTitle: cand.task.title,
        courseCode: cand.task.course,
        dueAt: cand.task.due_at,
        leadMinutes: cand.selectedLead,
        type: 'reminder',
        title: notifTitle,
        body: notifBody,
        createdAt: now.toISOString(),
        read: false
      };

      persistReminder(userId, newNotif, cand.crossedKeys, prefs.channels.inApp);
      cand.crossedKeys.forEach(key => { firedKeys[key] = nowMs; });
      if (prefs.channels.inApp) newlyCreated.push(newNotif);
      remainingDailySlots--;

      if (prefs.channels.push) {
        showBrowserNotification(notifTitle, notifBody, {
          taskId: cand.task.task_id,
          leadMin: cand.selectedLead
        });
      }
    }
  }

  // Digests belong to their scheduled minute; do not catch up hours after the slot.
  let updatedPrefs: Partial<NotificationPrefs> | undefined;
  if (prefs.digests?.dailyMorning && hourVancouver === 8 && minuteVancouver === 0 && !isQuietHoursActive(prefs.quietHours, now)) {
    const digestKey = `digest_daily_${todayVancouverStr}`;
    if (!firedKeys[digestKey] && prefs.lastDailyDigestDate !== todayVancouverStr) {
      const tasksDueToday = tasks.filter(t => {
        if (t.status === 'Done' || t.status === 'Submitted' || isTaskAnnouncement(t) || !t.due_at) return false;
        return isTaskDueToday(t, now);
      });

      if (tasksDueToday.length > 0) {
        const courseSummary = tasksDueToday.map(t => `${t.course || 'Task'}: ${t.title}`).join(', ');
        const notifTitle = `☀️ Daily Morning Briefing (${tasksDueToday.length} Due Today)`;
        const notifBody = `You have ${tasksDueToday.length} deadline${tasksDueToday.length > 1 ? 's' : ''} today: ${courseSummary.slice(0, 140)}${courseSummary.length > 140 ? '...' : ''}`;

        const newNotif: InAppNotification = {
          id: digestKey,
          type: 'daily_digest',
          title: notifTitle,
          body: notifBody,
          createdAt: now.toISOString(),
          read: false
        };

        const persisted = persistReminder(userId, newNotif, [digestKey], prefs.channels.inApp);
        if (prefs.channels.inApp) newlyCreated.push(newNotif);
        if (persisted) updatedPrefs = { ...updatedPrefs, lastDailyDigestDate: todayVancouverStr };

        if (prefs.channels.push) {
          showBrowserNotification(notifTitle, notifBody, {
            tag: `ubc-digest-daily-${todayVancouverStr}`
          });
        }
      }
    }
  }

  // 4. Evaluate Sunday Evening "Week Ahead" Digest (e.g. Sunday dayOfWeek === 7 and hour >= 18 outside quiet hours)
  if (prefs.digests?.weeklySunday && dayOfWeekVancouver === 7 && hourVancouver === 18 && minuteVancouver === 0 && !isQuietHoursActive(prefs.quietHours, now)) {
    const sundayKey = `digest_weekly_${todayVancouverStr}`;
    if (!firedKeys[sundayKey] && prefs.lastWeeklyDigestDate !== todayVancouverStr) {
      const nextWeekMs = nowMs + 7 * 24 * 60 * 60 * 1000;
      const tasksThisWeek = tasks.filter(t => {
        if (t.status === 'Done' || t.status === 'Submitted' || isTaskAnnouncement(t) || !t.due_at) return false;
        const d = parseLocalDate(t.due_at);
        if (!d) return false;
        const tMs = d.getTime();
        return tMs >= nowMs && tMs <= nextWeekMs;
      });

      if (tasksThisWeek.length > 0) {
        const notifTitle = `📅 Sunday Week Ahead (${tasksThisWeek.length} Deadlines This Week)`;
        const notifBody = `You have ${tasksThisWeek.length} item${tasksThisWeek.length > 1 ? 's' : ''} scheduled for the upcoming week. Review your schedule to stay ahead!`;

        const newNotif: InAppNotification = {
          id: sundayKey,
          type: 'weekly_digest',
          title: notifTitle,
          body: notifBody,
          createdAt: now.toISOString(),
          read: false
        };

        const persisted = persistReminder(userId, newNotif, [sundayKey], prefs.channels.inApp);
        if (prefs.channels.inApp) newlyCreated.push(newNotif);
        if (persisted) updatedPrefs = { ...updatedPrefs, lastWeeklyDigestDate: todayVancouverStr };

        if (prefs.channels.push) {
          showBrowserNotification(notifTitle, notifBody, {
            tag: `ubc-digest-weekly-${todayVancouverStr}`
          });
        }
      }
    }
  }

  return { newNotifications: newlyCreated, updatedPrefs };
}

// Generate formatted preview payload for Daily/Weekly digests
export function generateDigestPreview(type: 'daily' | 'weekly', tasks: Task[], now: Date = new Date()) {
  const nowMs = now.getTime();
  const todayVancouverStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const formattedToday = formatInTimeZone(now, TIMEZONE, 'EEEE, MMMM d, yyyy');

  if (type === 'daily') {
    const dailyTasks = tasks.filter(t => {
      if (t.status === 'Done' || t.status === 'Submitted' || isTaskAnnouncement(t) || !t.due_at) return false;
      return isTaskDueToday(t, now);
    });

    return {
      title: `☀️ Morning Briefing: Due Today (${formattedToday})`,
      subject: `[UBC Dashboard] Daily Digest: ${dailyTasks.length} Deadline${dailyTasks.length === 1 ? '' : 's'} Due Today`,
      periodLabel: `Today (${formattedToday})`,
      count: dailyTasks.length,
      tasks: dailyTasks,
      summaryText: dailyTasks.length === 0
        ? "Nothing due today! Great opportunity to review upcoming milestones or rest."
        : dailyTasks.length === 1
          ? "You have 1 task due today."
          : `You have ${dailyTasks.length} tasks due today.`
    };
  } else {
    const endOfWeekMs = nowMs + 7 * 24 * 60 * 60 * 1000;
    const weeklyTasks = tasks.filter(t => {
      if (t.status === 'Done' || t.status === 'Submitted' || isTaskAnnouncement(t) || !t.due_at) return false;
      const d = parseLocalDate(t.due_at);
      if (!d) return false;
      const tMs = d.getTime();
      return tMs >= nowMs && tMs <= endOfWeekMs;
    });

    return {
      title: `📅 Sunday Week Ahead: Upcoming Schedule`,
      subject: `[UBC Dashboard] Week Ahead: ${weeklyTasks.length} Task${weeklyTasks.length === 1 ? '' : 's'} This Week`,
      periodLabel: `Next 7 Days (Vancouver Time)`,
      count: weeklyTasks.length,
      tasks: weeklyTasks,
      summaryText: weeklyTasks.length === 0
        ? "No deadlines in the next 7 days. Your upcoming schedule is clear!"
        : `You have ${weeklyTasks.length} task${weeklyTasks.length === 1 ? '' : 's'} scheduled for this coming week.`
    };
  }
}
