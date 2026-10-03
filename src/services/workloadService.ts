import { Task } from '../types';
import { isValid } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { parseTaskDueDate, TIMEZONE, getCourseColor } from '../utils';

export interface DayWorkload {
  date: Date;
  dateKey: string; // "yyyy-MM-dd"
  dayName: string; // "Mon", "Tue"
  dayNumber: string; // "8"
  totalHours: number;
  tasks: Task[];
  isToday: boolean;
}

export interface CourseHoursBreakdown {
  course: string;
  hours: number;
  taskCount: number;
  colorClass: string;
}

export type WorkloadScale = 'light' | 'moderate' | 'heavy';

export interface WeekWorkload {
  weekIndex: number; // 0 = this week, 1 = next week, etc.
  weekLabel: string; // "This Week", "Next Week", "Week 3"
  startDate: Date;
  endDate: Date;
  dateRangeFormatted: string; // "Sep 1 – Sep 7"
  totalHours: number;
  taskCount: number;
  isCurrentWeek: boolean;
  isNextWeek: boolean;
  isCrunchWeek: boolean;
  intensity: WorkloadScale;
  byCourse: Record<string, CourseHoursBreakdown>;
  courseList: CourseHoursBreakdown[];
  days: DayWorkload[];
  tasks: Task[];
  overdueTaskCount?: number;
  overdueHours?: number;
}

export interface WorkloadSummary {
  weeks: WeekWorkload[];
  thisWeekHours: number;
  nextWeekHours: number;
  nextWeekIsCrunch: boolean;
  maxWeekHours: number;
  peakWeekLabel: string;
  totalUpcomingHours: number;
  totalPendingTasks: number; // In-horizon task count for self-consistency (V3-017)
  inHorizonTaskCount: number;
  beyondHorizonTaskCount: number;
  beyondHorizonHours: number;
  overdueTaskCount: number;
  overdueHours: number;
  averageWeeklyHours: number;
  thresholdHours: number;
}

/**
 * Helper to compute the Monday 'yyyy-MM-dd' for any given date in America/Vancouver (V3-018, V3-029).
 */
export function getVancouverMondayDateStr(dateOrNow?: Date | string): string {
  let dateObj: Date;
  if (!dateOrNow) {
    dateObj = new Date();
  } else if (typeof dateOrNow === 'string') {
    dateObj = parseTaskDueDate(dateOrNow) || new Date();
  } else {
    dateObj = isValid(dateOrNow) ? dateOrNow : new Date();
  }
  const dateStr = formatInTimeZone(dateObj, TIMEZONE, 'yyyy-MM-dd');
  const dayOfWeek = parseInt(formatInTimeZone(dateObj, TIMEZONE, 'i'), 10); // 1 = Monday, 7 = Sunday
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const mondayUtc = new Date(dateUtc.getTime() - (dayOfWeek - 1) * 86400000);
  return mondayUtc.toISOString().slice(0, 10);
}

/**
 * Helper to add N days to a 'yyyy-MM-dd' string safely.
 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const newDateUtc = new Date(dateUtc.getTime() + days * 86400000);
  return newDateUtc.toISOString().slice(0, 10);
}

/**
 * Returns sum of planned step durations for a task.
 * Kept separate from the task-level estimate to avoid corrupting workload forecasts (V3-398).
 */
export function getTaskSubtaskDurationSum(task: Task): number {
  if (!task.subtasks || task.subtasks.length === 0) return 0;
  let subtaskHours = 0;
  for (const st of task.subtasks) {
    if (st.duration) {
      const text = st.duration.toLowerCase();
      const hrMatch = text.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:hours?|hrs?|h)(?![a-z])/);
      const minMatch = text.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:minutes?|mins?|m)(?![a-z])/);
      if (hrMatch) subtaskHours += parseFloat(hrMatch[1]);
      if (minMatch) subtaskHours += parseFloat(minMatch[1]) / 60;
    }
  }
  return Math.round(subtaskHours * 10) / 10;
}

/**
 * Returns estimated hours for a task.
 * If task.estimated_hours is explicitly set, use it.
 * Otherwise, fall back to intelligent academic defaults based on task type.
 * Never let subtask durations implicitly override task-level estimates (V3-398).
 */
export function getTaskEstimatedHours(task: Pick<Task, 'title' | 'type' | 'estimated_hours'> & Partial<Task>): number {
  if (!task) return 2;
  const rawHours: unknown = task.estimated_hours;
  const parsed = typeof rawHours === 'number' 
    ? rawHours 
    : (typeof rawHours === 'string' && (rawHours as string).trim() !== '' ? parseFloat(rawHours as string) : NaN);
  if (!isNaN(parsed) && parsed > 0) {
    return Math.round(parsed * 10) / 10;
  }

  // Academic heuristic fallback based on task type and keywords
  const title = (task.title || '').toLowerCase();
  const type = (task.type || '').toLowerCase();

  // A recognized explicit type takes precedence over any title keywords.
  switch (type) {
    case 'exam': return 8;
    case 'project': return 6;
    case 'assignment': return 4;
    case 'lab':
    case 'lecture': return 2.5;
    case 'quiz': return 1.5;
    case 'reading': return 1;
  }

  if (/\b(final|midterm)\b/.test(title)) {
    return 8; // Study + sitting
  }
  if (/\b(milestone|deliverable)\b/.test(title)) {
    return 6;
  }
  if (/\b(essay|paper|report)\b/.test(title)) {
    return 4;
  }
  if (/\b(lab|tutorial)\b/.test(title)) {
    return 2.5;
  }
  if (/\b(quiz|webwork|test)\b/.test(title)) {
    return 1.5;
  }
  return 2; // general default
}

/**
 * Calculates intensity level based on hours and student threshold
 * Scale: light / moderate / heavy (mapping crunch to heavy)
 */
export function getWorkloadIntensity(hours: number, threshold = 15): WorkloadScale {
  if (hours < threshold * 0.55) return 'light';
  if (hours < threshold) return 'moderate';
  return 'heavy';
}

/**
 * Returns a one-line verdict string for next week workload.
 * Used by the Overview line and the More tools row.
 */
export function getNextWeekVerdict(tasks: Task[], thresholdHours = 15): string {
  const workload = computeWeeklyWorkload(tasks, thresholdHours);
  const nextWeekHours = workload.nextWeekHours;
  const nextWeekObj = workload.weeks[1];
  const intensity = nextWeekObj?.intensity || 'light';
  if (intensity === 'heavy') {
    return `Next week looks heavy: ${nextWeekHours} h`;
  }
  return `Next week: ${nextWeekHours} h — ${intensity}`;
}

/**
 * Computes week-by-week rollups for the next `numWeeks` starting with the current week (Monday start).
 * All week and day boundaries are strictly calculated in America/Vancouver timezone (V3-018, V3-029).
 * Overdue tasks from previous weeks are rolled into This Week (V3-016).
 * Task count and hours describe the consistent in-horizon set (V3-017).
 */
export function computeWeeklyWorkload(tasks: Task[] = [], thresholdHours = 15, numWeeks = 6, now: Date = new Date()): WorkloadSummary {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeWeeks = Math.max(1, numWeeks || 6);
  const safeThreshold = typeof thresholdHours === 'number' && !isNaN(thresholdHours) && thresholdHours > 0 ? thresholdHours : 15;
  // Current calendar day and Monday in America/Vancouver (V3-018, V3-029)
  const todayDateStr = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd');
  const currentMondayStr = getVancouverMondayDateStr(now);

  // Filter active pending tasks (ignore completed/submitted/read and non-actionable announcements)
  const pendingTasks = safeTasks.filter(t => {
    const statusLower = (t.status || '').toLowerCase();
    if (statusLower === 'done' || statusLower === 'submitted' || statusLower === 'read') {
      return false;
    }
    if ((t.type || '').toLowerCase() === 'announcement') {
      return false;
    }
    return !!t.due_at;
  });

  const weeks: WeekWorkload[] = [];
  let totalUpcomingHours = 0;
  let maxWeekHours = 0;
  let peakWeekLabel = 'None';

  // Last week Sunday string for beyond-horizon tracking (V3-017)
  const lastWeekMondayStr = addDaysToDateStr(currentMondayStr, (safeWeeks - 1) * 7);
  const lastWeekSundayStr = addDaysToDateStr(lastWeekMondayStr, 6);

  for (let i = 0; i < safeWeeks; i++) {
    const isCurrentWeek = i === 0;
    const isNextWeek = i === 1;

    const wStartStr = addDaysToDateStr(currentMondayStr, i * 7);
    const wEndStr = addDaysToDateStr(wStartStr, 6);
    // Start at Monday 00:00:00 and end at Sunday 23:59:59.999 in America/Vancouver (V3-029)
    const wStartDate = toDate(`${wStartStr}T00:00:00.000`, { timeZone: TIMEZONE });
    const wEndDate = toDate(`${wEndStr}T23:59:59.999`, { timeZone: TIMEZONE });
    
    // Create 7 days of the week based on Vancouver calendar dates (V3-018, V3-029)
    const days: DayWorkload[] = [];
    for (let d = 0; d < 7; d++) {
      const dayDateStr = addDaysToDateStr(wStartStr, d);
      const dayDate = toDate(`${dayDateStr}T12:00:00`, { timeZone: TIMEZONE });
      days.push({
        date: dayDate,
        dateKey: dayDateStr,
        dayName: formatInTimeZone(dayDate, TIMEZONE, 'EEE'),
        dayNumber: formatInTimeZone(dayDate, TIMEZONE, 'd'),
        totalHours: 0,
        tasks: [],
        isToday: dayDateStr === todayDateStr
      });
    }

    const byCourse: Record<string, CourseHoursBreakdown> = {};
    const weekTasks: Task[] = [];
    let weekTotalHours = 0;
    let weekOverdueHours = 0;
    let weekOverdueCount = 0;

    for (const task of pendingTasks) {
      const dueParsed = parseTaskDueDate(task.due_at);
      if (!dueParsed || !isValid(dueParsed)) continue;

      const taskDateKey = formatInTimeZone(dueParsed, TIMEZONE, 'yyyy-MM-dd');
      const isInWeek = taskDateKey >= wStartStr && taskDateKey <= wEndStr;
      const isOverdue = taskDateKey < currentMondayStr;

      // Regular tasks in this week OR overdue tasks rolled into current week (V3-016)
      if (isInWeek || (isCurrentWeek && isOverdue)) {
        const hours = getTaskEstimatedHours(task);
        weekTotalHours += hours;
        weekTasks.push(task);

        if (isOverdue && isCurrentWeek) {
          weekOverdueHours += hours;
          weekOverdueCount += 1;
        }

        // Add to course breakdown
        const courseName = task.course || 'Other';
        if (!byCourse[courseName]) {
          byCourse[courseName] = {
            course: courseName,
            hours: 0,
            taskCount: 0,
            colorClass: getCourseColor(courseName)
          };
        }
        byCourse[courseName].hours += hours;
        byCourse[courseName].taskCount += 1;

        // Add to specific day (overdue tasks land on Monday of current week for visibility)
        const dayMatch = days.find(d => d.dateKey === taskDateKey) || (isCurrentWeek && isOverdue ? days[0] : null);
        if (dayMatch) {
          dayMatch.totalHours = Math.round((dayMatch.totalHours + hours) * 10) / 10;
          dayMatch.tasks.push(task);
        }
      }
    }

    // Sort tasks in each day chronologically
    days.forEach(d => {
      d.tasks.sort((a, b) => {
        const dateA = parseTaskDueDate(a.due_at)?.getTime() || 0;
        const dateB = parseTaskDueDate(b.due_at)?.getTime() || 0;
        return dateA - dateB;
      });
    });

    // Round total and course hours
    weekTotalHours = Math.round(weekTotalHours * 10) / 10;
    Object.values(byCourse).forEach(c => {
      c.hours = Math.round(c.hours * 10) / 10;
    });

    let weekLabel = isCurrentWeek 
      ? 'This Week' 
      : isNextWeek 
        ? 'Next Week' 
        : `Week ${i + 1}`;

    const dateRangeFormatted = `${formatInTimeZone(wStartDate, TIMEZONE, 'MMM d')} – ${formatInTimeZone(wEndDate, TIMEZONE, 'MMM d')}`;
    const isCrunchWeek = weekTotalHours >= safeThreshold;
    const intensity = getWorkloadIntensity(weekTotalHours, safeThreshold);

    if (weekTotalHours > maxWeekHours) {
      maxWeekHours = weekTotalHours;
      peakWeekLabel = `${weekLabel} (${dateRangeFormatted})`;
    }

    totalUpcomingHours += weekTotalHours;

    weeks.push({
      weekIndex: i,
      weekLabel,
      startDate: wStartDate,
      endDate: wEndDate,
      dateRangeFormatted,
      totalHours: weekTotalHours,
      taskCount: weekTasks.length,
      isCurrentWeek,
      isNextWeek,
      isCrunchWeek,
      intensity,
      byCourse,
      courseList: Object.values(byCourse).sort((a, b) => b.hours - a.hours),
      days,
      overdueTaskCount: isCurrentWeek ? weekOverdueCount : 0,
      overdueHours: isCurrentWeek ? Math.round(weekOverdueHours * 10) / 10 : 0,
      tasks: weekTasks.sort((a, b) => {
        const dateA = parseTaskDueDate(a.due_at)?.getTime() || 0;
        const dateB = parseTaskDueDate(b.due_at)?.getTime() || 0;
        return dateA - dateB;
      })
    });
  }

  // Count distinct tasks falling within the computed horizon (V3-017)
  const inHorizonTaskIds = new Set<string>();
  weeks.forEach(w => {
    w.tasks.forEach(t => inHorizonTaskIds.add(t.task_id));
  });
  const inHorizonTaskCount = inHorizonTaskIds.size;

  // Beyond-horizon and overdue breakdown (V3-017, V3-016)
  let beyondHorizonHours = 0;
  let beyondHorizonTaskCount = 0;
  let overdueHours = 0;
  let overdueTaskCount = 0;

  pendingTasks.forEach(t => {
    const due = parseTaskDueDate(t.due_at);
    if (!due || !isValid(due)) return;
    const tKey = formatInTimeZone(due, TIMEZONE, 'yyyy-MM-dd');
    if (tKey > lastWeekSundayStr) {
      beyondHorizonTaskCount += 1;
      beyondHorizonHours += getTaskEstimatedHours(t);
    } else if (tKey < currentMondayStr) {
      overdueTaskCount += 1;
      overdueHours += getTaskEstimatedHours(t);
    }
  });

  const thisWeekHours = weeks[0]?.totalHours || 0;
  const nextWeekHours = weeks[1]?.totalHours || 0;
  const nextWeekIsCrunch = weeks[1]?.isCrunchWeek || false;
  const averageWeeklyHours = safeWeeks > 0 ? Math.round((totalUpcomingHours / safeWeeks) * 10) / 10 : 0;

  return {
    weeks,
    thisWeekHours,
    nextWeekHours,
    nextWeekIsCrunch,
    maxWeekHours,
    peakWeekLabel,
    totalUpcomingHours: Math.round(totalUpcomingHours * 10) / 10,
    totalPendingTasks: inHorizonTaskCount, // Matches hours for self-consistency (V3-017)
    inHorizonTaskCount,
    beyondHorizonTaskCount,
    beyondHorizonHours: Math.round(beyondHorizonHours * 10) / 10,
    overdueTaskCount,
    overdueHours: Math.round(overdueHours * 10) / 10,
    averageWeeklyHours,
    thresholdHours: safeThreshold
  };
}

/**
 * Checks if assigning a task to a given date pushes that specific week into crunch/overload.
 * Evaluates dates strictly in America/Vancouver and includes overdue backlog when checking current week (V3-016, V3-018, V3-029).
 */
export function checkDateWorkloadImpact(
  tasks: Task[] = [], 
  targetDueDate: string, 
  taskEstimatedHours = 3, 
  thresholdHours = 15,
  excludeTaskId?: string
): { 
  willOverload: boolean; 
  weekLabel: string; 
  currentHours: number; 
  newTotalHours: number; 
  threshold: number;
} {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeThreshold = typeof thresholdHours === 'number' && !isNaN(thresholdHours) && thresholdHours > 0 ? thresholdHours : 15;
  const safeHours = typeof taskEstimatedHours === 'number' && !isNaN(taskEstimatedHours) && taskEstimatedHours > 0 ? taskEstimatedHours : 0;

  const targetParsed = parseTaskDueDate(targetDueDate);
  if (!targetParsed || !isValid(targetParsed)) {
    return { willOverload: false, weekLabel: '', currentHours: 0, newTotalHours: 0, threshold: safeThreshold };
  }

  // Vancouver calendar week boundaries (V3-018, V3-029)
  const targetMondayStr = getVancouverMondayDateStr(targetParsed);
  const targetSundayStr = addDaysToDateStr(targetMondayStr, 6);
  const targetMondayDate = toDate(`${targetMondayStr}T12:00:00`, { timeZone: TIMEZONE });
  const targetSundayDate = toDate(`${targetSundayStr}T12:00:00`, { timeZone: TIMEZONE });

  // Current Vancouver week start
  const now = new Date();
  const currentMondayStr = getVancouverMondayDateStr(now);
  const nextMondayStr = addDaysToDateStr(currentMondayStr, 7);

  let weekLabel = `${formatInTimeZone(targetMondayDate, TIMEZONE, 'MMM d')} – ${formatInTimeZone(targetSundayDate, TIMEZONE, 'MMM d')}`;
  const isTargetCurrentWeek = (targetMondayStr === currentMondayStr);
  if (isTargetCurrentWeek) {
    weekLabel = `This Week (${weekLabel})`;
  } else if (targetMondayStr === nextMondayStr) {
    weekLabel = `Next Week (${weekLabel})`;
  }

  // Calculate current week load without this task
  let currentHours = 0;
  safeTasks.forEach(t => {
    if (t.task_id === excludeTaskId) return;
    const statusLower = (t.status || '').toLowerCase();
    if (statusLower === 'done' || statusLower === 'submitted' || statusLower === 'read') return;
    if ((t.type || '').toLowerCase() === 'announcement' || !t.due_at) return;
    const due = parseTaskDueDate(t.due_at);
    if (!due || !isValid(due)) return;
    const taskDateStr = formatInTimeZone(due, TIMEZONE, 'yyyy-MM-dd');

    if (taskDateStr >= targetMondayStr && taskDateStr <= targetSundayStr) {
      currentHours += getTaskEstimatedHours(t);
    } else if (isTargetCurrentWeek && taskDateStr < currentMondayStr) {
      // Overdue tasks from previous weeks rolled into the current week (V3-016)
      currentHours += getTaskEstimatedHours(t);
    }
  });

  const newTotalHours = Math.round((currentHours + safeHours) * 10) / 10;
  const willOverload = newTotalHours > safeThreshold;

  return {
    willOverload,
    weekLabel,
    currentHours: Math.round(currentHours * 10) / 10,
    newTotalHours,
    threshold: safeThreshold
  };
}

/** Combined weekly impact of the selected import draft, including the existing backlog. */
export function getImportWorkloadWarnings(existingTasks: Task[], selectedTasks: Task[], thresholdHours = 15) {
  const selectedIds = new Set(selectedTasks.map(t => t.task_id));
  const combinedTasks = [...existingTasks.filter(t => !selectedIds.has(t.task_id)), ...selectedTasks];
  const warnings = new Map<string, ReturnType<typeof checkDateWorkloadImpact>>();
  for (const task of selectedTasks) {
    if (!task.due_at || task.type === 'announcement' || ['done', 'submitted', 'read'].includes((task.status || '').toLowerCase())) continue;
    const impact = checkDateWorkloadImpact(combinedTasks, task.due_at, getTaskEstimatedHours(task), thresholdHours, task.task_id);
    if (impact.willOverload) warnings.set(impact.weekLabel, impact);
  }
  return [...warnings.values()];
}
