import { Task, CalendarDateDiff } from '../types';
import { parseTaskDueDate, sanitizeCanvasUrl } from '../utils';

export interface CalendarDiffResult {
  newTasks: Task[];
  dateChangedTasks: {
    existingTask: Task;
    oldDueDate: string;
    newDueDate: string;
    diff: CalendarDateDiff;
  }[];
  unchangedCount: number;
  totalParsed: number;
  syncTimestamp: string;
}

/**
 * Compares freshly parsed Canvas calendar tasks against existing user tasks.
 * Detects new items and modified due dates WITHOUT clobbering manual edits.
 * Filters out dismissedCanvasIds so student-deleted Canvas tasks are not resurrected.
 */
export function diffCanvasFeedAgainstTasks(
  canvasTasks: Task[],
  existingTasks: Task[],
  dismissedCanvasIds: string[] = []
): CalendarDiffResult {
  const dismissedSet = new Set(dismissedCanvasIds);
  const existingById = new Map<string, Task>();
  const existingByCourseAndTitle = new Map<string, Task>();

  existingTasks.forEach(t => {
    existingById.set(t.task_id, t);
    // Key by normalized course and title to catch same assignments
    const key = `${(t.course || '').trim().toLowerCase()}:::${(t.title || '').trim().toLowerCase()}`;
    existingByCourseAndTitle.set(key, t);
  });

  const newTasks: Task[] = [];
  const dateChangedTasks: {
    existingTask: Task;
    oldDueDate: string;
    newDueDate: string;
    diff: CalendarDateDiff;
  }[] = [];
  let unchangedCount = 0;

  const nowIso = new Date().toISOString();

  for (const cTask of canvasTasks) {
    // If student explicitly dismissed/deleted this Canvas task before, skip it
    if (dismissedSet.has(cTask.task_id)) {
      unchangedCount++;
      continue;
    }

    // Check if task exists by task_id
    let match = existingById.get(cTask.task_id);
    if (!match) {
      // Check if task exists by normalized course + title
      const key = `${(cTask.course || '').trim().toLowerCase()}:::${(cTask.title || '').trim().toLowerCase()}`;
      match = existingByCourseAndTitle.get(key);
    }

    if (!match) {
      // Brand new Canvas item! Put into Review Inbox
      newTasks.push({
        ...cTask,
        needs_review: true,
        source: 'canvas',
        status: 'Not Started',
        created_at: nowIso,
        updated_at: nowIso
      });
    } else {
      // Existing task found. Check if Canvas deadline changed
      const oldDue = match.due_at || '';
      const newDue = cTask.due_at || '';

      const oldTime = parseTaskDueDate(oldDue)?.getTime() || 0;
      const newTime = parseTaskDueDate(newDue)?.getTime() || 0;

      // If dates differ by more than 60 seconds (accounting for minor timezone formatting offsets)
      if (oldDue && newDue && Math.abs(oldTime - newTime) > 60000 && match.status !== 'Done' && match.status !== 'Submitted') {
        const diff: CalendarDateDiff = {
          oldDueDate: oldDue,
          newDueDate: newDue,
          canvasEventId: cTask.task_id,
          detectedAt: nowIso
        };
        dateChangedTasks.push({
          existingTask: match,
          oldDueDate: oldDue,
          newDueDate: newDue,
          diff
        });
      } else {
        unchangedCount++;
      }
    }
  }

  return {
    newTasks,
    dateChangedTasks,
    unchangedCount,
    totalParsed: canvasTasks.length,
    syncTimestamp: nowIso
  };
}

/**
 * Fetches and diffs the student's Canvas .ics calendar feed via the secure backend API.
 */
export async function fetchAndSyncCanvasFeed(
  feedUrl: string,
  existingTasks: Task[],
  authToken?: string,
  dismissedCanvasIds: string[] = []
): Promise<{ diffResult: CalendarDiffResult; rawCourses: any[] }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch('/api/parse/ics', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: feedUrl })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw Object.assign(new Error(errorData.error || 'Failed to connect to Canvas calendar feed.'), { status: response.status });
  }

  const data = await response.json();
  const canvasTasks: Task[] = (data.tasks || []).map((task: Task) => ({
    ...task, canvas_url: sanitizeCanvasUrl(task.canvas_url)
  }));
  const courses = data.courses || [];

  const diffResult = diffCanvasFeedAgainstTasks(canvasTasks, existingTasks, dismissedCanvasIds);

  return {
    diffResult,
    rawCourses: courses
  };
}
