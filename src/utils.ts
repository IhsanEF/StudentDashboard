import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { isPast, isToday, addDays, isBefore, format, isValid, endOfDay } from 'date-fns';
import { Task } from './types';

export { formatInTimeZone, toDate };

export function zonedTimeToUtc(dateStr: string, timeZone: string = TIMEZONE): Date {
  return toDate(dateStr, { timeZone });
}

export function formatVancouverDate(targetDateStr?: string): string {
  if (!targetDateStr) return '';
  try {
    const dateWithTime = targetDateStr.includes('T') ? targetDateStr : `${targetDateStr}T00:00:00`;
    const zoned = toDate(dateWithTime, { timeZone: TIMEZONE });
    return isValid(zoned) ? formatInTimeZone(zoned, TIMEZONE, 'MMM d, yyyy') : targetDateStr;
  } catch {
    return targetDateStr;
  }
}

export const formatGroupTargetDate = formatVancouverDate;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export const TIMEZONE = 'America/Vancouver';

export function toVancouverISO(date: Date = new Date()) {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Parse a task's due_at string into a valid Date object.
 * If due_at is a date-only string (e.g. '2026-09-15'), parse it as Vancouver end-of-day (23:59:59.999)
 * so that it doesn't default to UTC midnight and trigger false 'Overdue' warnings.
 */
export function parseTaskDueDate(dueAtStr?: string): Date | null {
  if (!dueAtStr || typeof dueAtStr !== 'string') return null;
  const trimmed = dueAtStr.trim();
  if (!trimmed) return null;

  try {
    // Calendar deadlines remain Vancouver end-of-day, including DST transition days.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const date = toDate(`${trimmed}T23:59:59.999`, { timeZone: TIMEZONE });
      return isValid(date) ? date : null;
    }

    // Preserve compact ICS floating timestamps, anchored to Vancouver.
    const compactIcsMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (compactIcsMatch) {
      const formatted = `${compactIcsMatch[1]}-${compactIcsMatch[2]}-${compactIcsMatch[3]}T${compactIcsMatch[4]}:${compactIcsMatch[5]}:${compactIcsMatch[6]}`;
      const date = toDate(formatted, { timeZone: TIMEZONE });
      return isValid(date) ? date : null;
    }

    // Explicit offsets keep their instant; offset-less wall times use Vancouver.
    // toDate validates calendar days. Do not fall back to Date, which rolls invalid
    // days into the next month and interprets naive timestamps in the browser zone.
    const parsed = toDate(trimmed, { timeZone: TIMEZONE });
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const parseLocalDate = parseTaskDueDate;

export function isDateOnly(dueAtStr?: string): boolean {
  if (!dueAtStr || typeof dueAtStr !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dueAtStr.trim());
}

export function toVancouverDateString(dateOrStr?: string | Date | null): string {
  if (!dateOrStr) {
    return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  }
  if (typeof dateOrStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrStr.trim())) {
    return dateOrStr.trim();
  }
  const dateObj = typeof dateOrStr === 'string' ? parseTaskDueDate(dateOrStr) : dateOrStr;
  if (!dateObj || !isValid(dateObj)) {
    return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  }
  return formatInTimeZone(dateObj, TIMEZONE, 'yyyy-MM-dd');
}

export function safeGetTime(dateVal: any, fallback: number = Infinity): number {
  if (!dateVal) return fallback;
  const parsed = parseTaskDueDate(String(dateVal)) || new Date(dateVal);
  const time = parsed.getTime();
  return Number.isNaN(time) ? fallback : time;
}

/** Includes elapsed timed deadlines on today's Vancouver calendar date. */
export function isTaskDueToday(task: Task, now: Date = new Date()): boolean {
  const dueDate = parseTaskDueDate(task.due_at);
  return dueDate !== null && toVancouverDateString(dueDate) === toVancouverDateString(now);
}

export function isTaskSnoozed(task: Task): boolean {
  if (!task.check_again_at) return false;
  const checkDate = new Date(task.check_again_at);
  return isValid(checkDate) && checkDate.getTime() > Date.now();
}

export function formatReadableDate(dueAtStr: string) {
  if (!dueAtStr) return '';
  const parsed = parseTaskDueDate(dueAtStr);
  if (!parsed) return dueAtStr;

  try {
    // If it was provided as date-only, format date without artificial time in Vancouver TZ
    if (isDateOnly(dueAtStr)) {
      return formatInTimeZone(parsed, TIMEZONE, 'MMM d, yyyy');
    }
    return formatInTimeZone(parsed, TIMEZONE, 'MMM d, yyyy h:mm a');
  } catch {
    return dueAtStr;
  }
}

export function isTaskAnnouncement(task: Task): boolean {
  return task.type === 'announcement';
}

export function isScheduleEvent(task: Task): boolean {
  return task.type === 'lecture' || (task.type === 'lab' && (!task.points_possible || task.points_possible === '0'));
}

/** Coursework counted in completion totals, including completed and snoozed tasks. */
export function isActiveAcademicTask(task: Task): boolean {
  return Boolean(task) && !isTaskAnnouncement(task) && !isScheduleEvent(task);
}

export function isActionableTask(task: Task): boolean {
  if (!isActiveAcademicTask(task)) return false;
  if (task.status === 'Done' || task.status === 'Submitted') return false;
  if (isTaskSnoozed(task)) return false;
  return true;
}

export function isWithinNext7VancouverDays(dueDate: Date, now: Date): boolean {
  const today = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const due = formatInTimeZone(dueDate, TIMEZONE, 'yyyy-MM-dd');
  return due >= today && due <= end.toISOString().slice(0, 10);
}

export function getTaskUrgencyCategory(task: Task, now: Date = new Date()): 'overdue' | 'today' | 'upcoming' | 'later' | 'nodate' | 'past_schedule' {
  if (!task.due_at) return 'nodate';
  const dueDate = parseTaskDueDate(task.due_at);
  if (!dueDate) return 'later';

  const vancouverTodayStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const taskVancouverDateStr = formatInTimeZone(dueDate, TIMEZONE, 'yyyy-MM-dd');

  // If due timestamp is strictly in the past (and not today end-of-day in Vancouver)
  if (dueDate.getTime() < now.getTime()) {
    if (taskVancouverDateStr === vancouverTodayStr && isDateOnly(task.due_at)) {
      return 'today';
    }
    // Schedule events (recurring lectures/classes) that passed should not flood the Overdue actionable queue
    if (isScheduleEvent(task)) {
      return 'past_schedule';
    }
    return 'overdue';
  }

  // If due on today's calendar date in Vancouver
  if (taskVancouverDateStr === vancouverTodayStr) {
    return 'today';
  }

  // Include the whole seventh Vancouver calendar day.
  if (isWithinNext7VancouverDays(dueDate, now)) {
    return 'upcoming';
  }

  return 'later';
}

export function getTaskUrgencyColor(task: Task, now: Date = new Date()) {
  const needsReview = task.needs_review === true;
  if (needsReview) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (task.status === 'Done') return 'bg-green-100 text-green-800 border-green-200';
  if (task.status === 'Submitted') return 'bg-teal-100 text-teal-800 border-teal-200';
  if (task.status === 'Working') return 'bg-purple-100 text-purple-800 border-purple-200';

  if (!task.due_at) return 'bg-gray-100 text-gray-800 border-gray-200';

  const category = getTaskUrgencyCategory(task, now);
  if (category === 'today') return 'bg-orange-100 text-orange-800 border-orange-200';
  if (category === 'overdue') return 'bg-red-100 text-red-800 border-red-200';
  if (category === 'upcoming') return 'bg-blue-100 text-blue-800 border-blue-200';

  return 'bg-gray-100 text-gray-800 border-gray-200';
}

export function getCourseColor(courseName: string) {
  // Generate a consistent color based on course name string
  const colors = [
    'bg-blue-50 text-blue-700 border-blue-200',
    'bg-indigo-50 text-indigo-700 border-indigo-200',
    'bg-violet-50 text-violet-700 border-violet-200',
    'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
    'bg-rose-50 text-rose-700 border-rose-200',
    'bg-orange-50 text-orange-700 border-orange-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'bg-cyan-50 text-cyan-700 border-cyan-200',
  ];
  let hash = 0;
  for (let i = 0; i < courseName.length; i++) {
    hash = courseName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Safely sanitizes external URLs, only permitting http, https, and mailto schemes.
 * Discards javascript:, data:, vbscript: and malformed URIs.
 */
export function sanitizeUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

/** Task submission links must be web URLs; course contact links may still use mailto. */
export function sanitizeCanvasUrl(url?: string | null): string {
  const safe = sanitizeUrl(url);
  return safe && /^https?:/.test(safe) ? safe : '';
}

export function getUrlHostname(url?: string | null): string {
  const safe = sanitizeCanvasUrl(url);
  return safe ? new URL(safe).hostname : '';
}

export function isTrustedCanvasHost(host: string): boolean {
  return host === 'canvas.ubc.ca' || host.endsWith('.ubc.ca') || host.endsWith('.instructure.com');
}

export function canvasLinkReviewWarning(url?: string | null): string {
  if (!url?.trim()) return '';
  const host = getUrlHostname(url);
  if (!host) return 'This task link is not an HTTP(S) web link and will be removed on import.';
  return isTrustedCanvasHost(host) ? '' : `External task link: ${host}. This is outside UBC and Canvas; check the destination before opening it.`;
}

/**
 * Standard UBC percentage to letter grade scale mapping.
 * Bands: A+ 90–100, A 85–89.99, A- 80–84.99, B+ 76–79.99, B 72–75.99,
 * B- 68–71.99, C+ 64–67.99, C 60–63.99, C- 55–59.99, D 50–54.99, F below 50.
 */
export function getUbcLetterGrade(percentage: number): string {
  if (isNaN(percentage)) return '';
  if (percentage >= 90) return 'A+';
  if (percentage >= 85) return 'A';
  if (percentage >= 80) return 'A-';
  if (percentage >= 76) return 'B+';
  if (percentage >= 72) return 'B';
  if (percentage >= 68) return 'B-';
  if (percentage >= 64) return 'C+';
  if (percentage >= 60) return 'C';
  if (percentage >= 55) return 'C-';
  if (percentage >= 50) return 'D';
  return 'F';
}

/**
 * Maps UBC letter grades to grade points on the 4.33 scale (with optional 4.00 OMSAS scale).
 * 4.33 scale: A+ 4.33, A 4.0, A- 3.7, B+ 3.3, B 3.0, B- 2.7, C+ 2.3, C 2.0, C- 1.7, D 1.0, F 0.
 */
export function getUbcGradePoints(letter?: string, scale: '4.33' | '4.00' = '4.33'): number {
  if (!letter) return 0.0;
  const norm = letter.trim().toUpperCase();
  if (scale === '4.00') {
    switch (norm) {
      case 'A+': return 4.0;
      case 'A': return 3.9;
      case 'A-': return 3.7;
      case 'B+': return 3.3;
      case 'B': return 3.0;
      case 'B-': return 2.7;
      case 'C+': return 2.3;
      case 'C': return 2.0;
      case 'C-': return 1.7;
      case 'D': return 1.0;
      case 'F': default: return 0.0;
    }
  }
  switch (norm) {
    case 'A+': return 4.33;
    case 'A': return 4.0;
    case 'A-': return 3.7;
    case 'B+': return 3.3;
    case 'B': return 3.0;
    case 'B-': return 2.7;
    case 'C+': return 2.3;
    case 'C': return 2.0;
    case 'C-': return 1.7;
    case 'D': return 1.0;
    case 'F': default: return 0.0;
  }
}

/**
 * Calculates grade percentage given earned and possible points.
 */
export function calculateGradePercentage(earnedStr?: string | number, possibleStr?: string | number): number | null {
  const earned = parseFloat(String(earnedStr ?? ''));
  const possible = parseFloat(String(possibleStr ?? ''));
  if (isNaN(earned) || isNaN(possible) || possible <= 0) {
    return null;
  }
  return Math.round((earned / possible) * 1000) / 10;
}

/**
 * Normalizes course codes for robust comparisons (e.g. 'CPSC 310' -> 'CPSC310').
 */
export function normalizeCourseCode(code?: string): string {
  if (!code || typeof code !== 'string') return '';
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
