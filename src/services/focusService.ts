import { Task } from '../types';
import { isActionableTask, safeGetTime } from '../utils';

/**
 * Returns prioritized actionable tasks:
 * 1. Currently 'Working' tasks first
 * 2. Then earliest due date
 * Filtered by isActionableTask (excludes announcements, schedule events, Done/Submitted, and snoozed).
 */
export function pickNextTasks(tasks: Task[]): Task[] {
  if (!Array.isArray(tasks)) return [];

  return tasks
    .filter(isActionableTask)
    .sort((a, b) => {
      // Priority 1: Currently 'Working' tasks first
      if (a.status === 'Working' && b.status !== 'Working') return -1;
      if (b.status === 'Working' && a.status !== 'Working') return 1;

      // Priority 2: Earliest due date
      const timeA = safeGetTime(a.due_at, Infinity);
      const timeB = safeGetTime(b.due_at, Infinity);
      return timeA - timeB;
    });
}
