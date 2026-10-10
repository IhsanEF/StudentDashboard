import TaskFields, { validateTaskIdentity, taskSaveError } from './TaskFields';
import React, { useState } from 'react';
import { deleteField } from 'firebase/firestore';
import { toDate } from 'date-fns-tz';
import { Task, TaskType, TaskStatus } from '../types';
import { useTasksContext } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { useViewMode } from '../hooks/useViewMode';
import { getAuthHeader } from '../auth';
import {
  X,
  Trash2,
  ListTree,
  Sparkles,
  Clock,
  Flame,
  AlertCircle,
  Check,
  ChevronDown
} from 'lucide-react';
import TaskBreakdownModal from './TaskBreakdownModal';
import { checkDateWorkloadImpact, getTaskEstimatedHours } from '../services/workloadService';
import { formatReadableDate, normalizeCourseCode, formatInTimeZone, TIMEZONE, parseTaskDueDate } from '../utils';

interface EditTaskModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 2020 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

export function validateDueDate(val?: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) {
    return { valid: true };
  }
  const trimmed = val.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?(.*)$/);
  if (!match) {
    return {
      valid: false,
      error: 'Please enter a valid due date in YYYY-MM-DD or YYYY-MM-DDTHH:mm format (e.g. 2026-10-05T23:59).'
    };
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (year < 2020 || year > 2100) {
    return { valid: false, error: 'Due date year must be between 2020 and 2100.' };
  }
  if (!isValidCalendarDate(year, month, day)) {
    return { valid: false, error: `Invalid calendar date ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} (check days in month).` };
  }
  if (match[4] && match[5]) {
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return { valid: false, error: 'Time must be between 00:00 and 23:59.' };
    }
  }
  try {
    const parsed = parseTaskDueDate(trimmed);
    if (!parsed || isNaN(parsed.getTime())) {
      return { valid: false, error: 'Could not parse due date into a valid deadline.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid due date format.' };
  }
}

function formatForDatetimeLocal(val?: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  try {
    const parsed = parseTaskDueDate(trimmed);
    if (parsed && !isNaN(parsed.getTime())) {
      return formatInTimeZone(parsed, TIMEZONE, "yyyy-MM-dd'T'HH:mm");
    }
  } catch {
    // fallback
  }
  return '';
}

export default function EditTaskModal({ task, isOpen, onClose }: EditTaskModalProps) {
  const { tasks, courses, updateTask, deleteTask, notificationPrefs, isDemoMode } = useTasksContext();
  const { isSimple } = useViewMode();
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  const [title, setTitle] = useState(task.title || '');
  const [course, setCourse] = useState(task.course || 'General');
  const [type, setType] = useState<TaskType | string>(task.type || 'assignment');
  const [categoryId, setCategoryId] = useState(task.category_id || '');
  const [categoryName, setCategoryName] = useState(task.category_name || '');
  const [dueAt, setDueAt] = useState(() => formatForDatetimeLocal(task.due_at));
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const [statusEdited, setStatusEdited] = useState(false);
  const [status, setStatus] = useState<TaskStatus | string>(task.status === 'Read' ? 'Done' : (task.status || 'Not Started'));
  const [hoursEdited, setHoursEdited] = useState(false);
  React.useEffect(() => {
    if (!statusEdited) setStatus(task.status === 'Read' ? 'Done' : (task.status || 'Not Started'));
  }, [task.status, statusEdited]);
  const [estimatedHours, setEstimatedHours] = useState<string>(
    typeof task.estimated_hours === 'number' ? String(task.estimated_hours) : ''
  );
  const [pointsEarned, setPointsEarned] = useState(task.points_earned || '');
  const [pointsPossible, setPointsPossible] = useState(task.points_possible || '');
  const [gradeText, setGradeText] = useState(task.grade_text || '');
  const [feedback, setFeedback] = useState(task.feedback || '');
  const [summary, setSummary] = useState(task.summary || '');
  const [nextAction, setNextAction] = useState(task.next_action || '');
  const [canvasUrl, setCanvasUrl] = useState(task.canvas_url || '');
  const [identityErrors, setIdentityErrors] = useState({ title: '', course: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isEstimatingAI, setIsEstimatingAI] = useState(false);
  const [aiEffortFeedback, setAiEffortFeedback] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);

  const initialComputedPct = React.useMemo(() => {
    const pe = parseFloat(task.points_earned || '');
    const pp = parseFloat(task.points_possible || '');
    if (!isNaN(pe) && !isNaN(pp) && pp > 0) {
      return `${Math.round((pe / pp) * 1000) / 10}%`;
    }
    return null;
  }, [task.points_earned, task.points_possible]);

  const thresholdHours = notificationPrefs?.workloadThresholdHours || 15;

  // Find course to populate grade categories if available
  const matchingCourse = courses?.find(c => normalizeCourseCode(c.course_code) === normalizeCourseCode(course));
  const availableCategories = matchingCourse?.grade_categories || [];

  // Shared heuristic fallback based on task heuristic
  const heuristicHours = getTaskEstimatedHours({
    ...task,
    title,
    type: type as TaskType,
    course,
    estimated_hours: undefined
  });

  const parsedHours = typeof estimatedHours === 'number'
    ? estimatedHours
    : (String(estimatedHours).trim() === '' ? NaN : parseFloat(String(estimatedHours)));

  const hasExplicitHours = Number.isFinite(parsedHours) && parsedHours > 0;
  const validExplicitHours = hasExplicitHours ? Math.min(100, Math.max(0.1, parsedHours)) : undefined;

  // Real-time overload impact check when due date or hours change - unified fallback with save
  const numericHours = validExplicitHours ?? heuristicHours;

  const workloadImpact = checkDateWorkloadImpact(
    tasks,
    dueAt,
    numericHours,
    thresholdHours,
    task.task_id
  );

  const hasGrade = Boolean(
    (task.points_earned && task.points_earned.trim().length > 0) ||
    (task.grade_text && task.grade_text.trim().length > 0) ||
    (task.feedback && task.feedback.trim().length > 0)
  );
  const [gradeDetailsOpen, setGradeDetailsOpen] = useState(hasGrade);

  if (!isOpen) return null;

  const handleEstimateWithAI = async () => {
    if (isDemoMode) {
      setEstimatedHours(String(heuristicHours));
      setHoursEdited(true);
      setAiEffortFeedback(`Demo estimate: ~${heuristicHours}h using the same workload rules as your task cards.`);
      return;
    }
    setIsEstimatingAI(true);
    setAiEffortFeedback(null);
    try {
      const authHeaders = await getAuthHeader();
      if (!authHeaders.Authorization) throw new Error('Please sign in to use the AI estimator.');
      const response = await fetch('/api/ai/estimate-effort', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          title,
          course,
          type,
          summary,
          subtasks: task.subtasks
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Could not estimate effort.');
      }
      const data = await response.json();
      if (typeof data.estimatedHours === 'number' && Number.isFinite(data.estimatedHours) && data.estimatedHours > 0 && data.estimatedHours <= 100) {
        setEstimatedHours(String(data.estimatedHours));
        setHoursEdited(true);
        const isAI = data.source === 'gemini_ai';
        setAiEffortFeedback(isAI
          ? `✨ AI Estimate: ${data.explanation || `${data.estimatedHours}h suggested`}`
          : `Heuristic: ${data.explanation || `${data.estimatedHours}h suggested`}`
        );
      } else {
        throw new Error('The estimator returned an invalid estimate.');
      }
    } catch (err: any) {
      console.warn('AI effort estimate error:', err);
      setAiEffortFeedback(`Estimate unavailable: ${err?.message || 'Please try again.'} Your hours have not changed.`);
    } finally {
      setIsEstimatingAI(false);
    }
  };

  const handleAcceptCanvasDiff = () => {
    if (task.canvas_date_diff) {
      const formatted = formatForDatetimeLocal(task.canvas_date_diff.newDueDate);
      setDueAt(formatted);
      setDueDateError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    const errors = validateTaskIdentity(title, course);
    setIdentityErrors(errors);
    if (errors.title || errors.course) {
      setIsSaving(false);
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedCourse = course.trim();

    const trimmedDue = dueAt.trim();
    let finalDueAt = '';
    if (trimmedDue) {
      const validation = validateDueDate(trimmedDue);
      if (!validation.valid) {
        const errMsg = validation.error || 'Please enter a valid due date.';
        setSaveError(errMsg);
        setDueDateError(errMsg);
        setIsSaving(false);
        return;
      }
      try {
        if (trimmedDue.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmedDue)) {
          finalDueAt = new Date(trimmedDue).toISOString();
        } else {
          const isoLike = trimmedDue.includes('T') ? trimmedDue : `${trimmedDue}T23:59:59`;
          const zoned = toDate(isoLike, { timeZone: TIMEZONE });
          finalDueAt = zoned.toISOString();
        }
      } catch {
        finalDueAt = trimmedDue;
      }
    }

    try {
      let finalGradeText = gradeText.trim();
      const pEarned = parseFloat(pointsEarned);
      const pPossible = parseFloat(pointsPossible);
      if (!isNaN(pEarned) && !isNaN(pPossible) && pPossible > 0) {
        const pct = Math.round((pEarned / pPossible) * 1000) / 10;
        const computedPct = `${pct}%`;
        // Only auto-fill grade_text when the field is blank or still equals the previously auto-computed percentage;
        // otherwise keep the student's text (store the percentage separately if needed).
        if (!finalGradeText || (initialComputedPct && finalGradeText === initialComputedPct)) {
          finalGradeText = computedPct;
        }
      }

      const finalStatus = status === 'Read' ? 'Done' : status;

      const updates: any = {
        title: trimmedTitle,
        course: trimmedCourse,
        type,
        due_at: finalDueAt,
        canvas_date_diff: deleteField(), // Clear date diff on explicit save
        points_earned: pointsEarned.trim(),
        points_possible: pointsPossible.trim(),
        grade_text: finalGradeText,
        feedback: feedback.trim(),
        summary: summary.trim(),
        next_action: nextAction.trim(),
        canvas_url: canvasUrl.trim(),
        last_interaction_at: new Date().toISOString()
      };

      if (statusEdited) updates.status = finalStatus;

      if (hoursEdited) {
        updates.estimated_hours = validExplicitHours !== undefined ? validExplicitHours : deleteField();
      }

      if (categoryId) {
        updates.category_id = categoryId;
        updates.category_name = categoryName;
      } else if (task.category_id || task.category_name) {
        updates.category_id = deleteField();
        updates.category_name = deleteField();
      }

      const updatePromise = updateTask(task.task_id, updates);
      // If offline or network hangs, race against 500ms timeout so modal closes optimistically
      // instead of spinning indefinitely on 'Saving...' while changes persist to offline store.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        updatePromise.catch((err: any) => console.error('Offline task update error:', err));
        onClose();
      } else {
        await updatePromise;
        onClose();
      }
    } catch (err: any) {
      console.error('Failed to update task:', err);
      setSaveError(taskSaveError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const deletePromise = deleteTask(task.task_id);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        deletePromise.catch((err: any) => console.error('Offline task delete error:', err));
        onClose();
      } else {
        await Promise.race([
          deletePromise,
          new Promise((resolve) => setTimeout(resolve, 500))
        ]);
        onClose();
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const subtasksCount = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter(st => st.done).length || 0;

  return (
    <>
      <div
        ref={modalRef}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-modal-title"
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
      >
        <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">

          {/* Modal Header */}
          <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <div>
              <h2 id="edit-task-modal-title" className="text-lg font-bold text-slate-900">
                Edit task
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Modal Form Content */}
          <form id="edit-task-form" onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-sm flex-1">

            {saveError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-2.5 text-red-700 text-xs font-semibold animate-in fade-in">
                <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">{saveError}</div>
              </div>
            )}

            {/* Imported date Diff Banner if exists */}
            {task.canvas_date_diff && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                    <AlertCircle size={16} className="text-amber-600" />
                    <span>Imported date change</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAcceptCanvasDiff}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer shadow-xs"
                  >
                    <Check size={12} />
                    <span>Apply imported date</span>
                  </button>
                </div>
                <p className="text-xs text-amber-800">
                  An earlier import changed this deadline from <strong>{formatReadableDate(task.canvas_date_diff.oldDueDate)}</strong> to <strong className="text-blue-700">{formatReadableDate(task.canvas_date_diff.newDueDate)}</strong>.
                </p>
              </div>
            )}

            <TaskFields identityErrors={identityErrors} prefix="edit-task" title={title} course={course} type={type} dueAt={dueAt}
              status={status} summary={summary} dueDateError={dueDateError}
              onTitleChange={setTitle} onCourseChange={setCourse} onTypeChange={setType}
              onStatusChange={value => { setStatus(value); setStatusEdited(true); }} onNotesChange={setSummary}
              onDueChange={value => { setDueAt(value); setDueDateError(validateDueDate(value).error || null); }} />

            {/* Real-time Overload / Crunch Warning Banner */}
            {workloadImpact.willOverload && status !== 'Done' && status !== 'Submitted' && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-rose-900 text-xs">
                <Flame size={16} className="text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">Workload Crunch Warning:</strong>
                  <p className="mt-0.5">
                    This task brings <strong>{workloadImpact.weekLabel}</strong> load to{' '}
                    <strong>{workloadImpact.newTotalHours}h</strong> (exceeding your {workloadImpact.threshold}h weekly limit).
                  </p>
                </div>
              </div>
            )}

            {/* Detailed only: Two disclosures */}
            {!isSimple && (
              <>
                {/* Disclosure 1: More details */}
                <details className="group bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                  <summary className="px-4 py-3 text-xs font-bold text-slate-700 uppercase flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors select-none">
                    <span>More details</span>
                    <ChevronDown size={16} className="text-slate-400 group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 pt-2 border-t border-slate-200 space-y-3">
                    {/* Hours box + Suggest hours (uses AI) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="edit-task-effort" className="text-xs font-bold text-slate-700 uppercase flex items-center gap-1.5">
                          <Clock size={14} className="text-indigo-600" />
                          <span>Estimated Effort Hours</span>
                        </label>
                        <button
                          type="button"
                          onClick={handleEstimateWithAI}
                          disabled={isEstimatingAI}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles size={12} />
                          <span>{isEstimatingAI ? 'Suggesting...' : 'Suggest hours (uses AI)'}</span>
                        </button>
                      </div>
                      <input
                        id="edit-task-effort"
                        type="number"
                        min="0.1"
                        max="100"
                        step="any"
                        placeholder={`~${heuristicHours}h`}
                        value={estimatedHours}
                        onChange={e => {
                          setHoursEdited(true);
                          const val = e.target.value;
                          setEstimatedHours(val);
                        }}
                        className="w-28 bg-white border border-slate-200 rounded-lg px-3 py-1.5 font-bold text-slate-800 text-sm outline-none focus:border-blue-500"
                      />
                      {aiEffortFeedback && (
                        <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-2">
                          {aiEffortFeedback}
                        </p>
                      )}
                    </div>

                    {/* Steps */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ListTree size={16} className="text-indigo-600 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-indigo-900">
                            Steps ({completedSubtasks} of {subtasksCount})
                          </p>
                          <p className="text-[11px] text-indigo-700">
                            {subtasksCount > 0 ? 'View and update steps' : 'Plan the steps with start and do-by dates'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBreakdownModalOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                      >
                        <Sparkles size={12} />
                        <span>{subtasksCount > 0 ? 'Edit steps' : 'Plan the steps'}</span>
                      </button>
                    </div>

                    {/* Resource link */}
                    <div>
                      <label htmlFor="edit-task-url" className="text-xs font-bold text-slate-500 uppercase block mb-1">
                        Resource / submission link
                      </label>
                      <input
                        id="edit-task-url"
                        type="url"
                        value={canvasUrl}
                        onChange={e => setCanvasUrl(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 text-xs"
                        placeholder="https://example.com/assignment"
                      />
                    </div>

                    {/* Next Action */}
                    <div>
                      <label htmlFor="edit-task-next-action" className="text-xs font-bold text-slate-500 uppercase block mb-1">
                        Next Action
                      </label>
                      <input
                        id="edit-task-next-action"
                        type="text"
                        value={nextAction}
                        onChange={e => setNextAction(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 text-xs"
                        placeholder="e.g. Finish part 2 questions"
                      />
                    </div>

                    {/* Syllabus Grade Category */}
                    {availableCategories.length > 0 && (
                      <div>
                        <label htmlFor="edit-task-category" className="text-xs font-bold text-slate-500 uppercase block mb-1">
                          Syllabus Grade Category
                        </label>
                        <select
                          id="edit-task-category"
                          value={categoryId}
                          onChange={e => {
                            const newCatId = e.target.value;
                            setCategoryId(newCatId);
                            const matchedCat = availableCategories.find(c => c.id === newCatId);
                            setCategoryName(matchedCat?.name || '');
                          }}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-blue-500 cursor-pointer text-sm"
                        >
                          <option value="">Uncategorized (Not counted toward syllabus grade)</option>
                          {availableCategories.map(cat => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name} ({cat.weight}%)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </details>

                {/* Disclosure 2: Grade & feedback */}
                <details open={gradeDetailsOpen} onToggle={e => setGradeDetailsOpen(e.currentTarget.open)} className="group bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                  <summary className="px-4 py-3 text-xs font-bold text-slate-700 uppercase flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors select-none">
                    <span>Grade &amp; feedback</span>
                    <ChevronDown size={16} className="text-slate-400 group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 pt-2 border-t border-slate-200 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="edit-task-earned" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                          Points Earned
                        </label>
                        <input
                          id="edit-task-earned"
                          type="text"
                          value={pointsEarned}
                          onChange={e => setPointsEarned(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-sm font-bold text-emerald-700"
                          placeholder="e.g. 48"
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-task-possible" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                          Points Possible
                        </label>
                        <input
                          id="edit-task-possible"
                          type="text"
                          value={pointsPossible}
                          onChange={e => setPointsPossible(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-sm font-semibold text-slate-700"
                          placeholder="e.g. 50"
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-task-grade-text" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                          Grade Text / Status
                        </label>
                        <input
                          id="edit-task-grade-text"
                          type="text"
                          value={gradeText}
                          onChange={e => setGradeText(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-sm font-bold text-blue-700"
                          placeholder="e.g. 96% or A+"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="edit-task-feedback" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                        Instructor Feedback
                      </label>
                      <textarea
                        id="edit-task-feedback"
                        rows={2}
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs"
                        placeholder="e.g. Great analysis on test coverage! Minor edge case missed."
                      />
                    </div>
                  </div>
                </details>
              </>
            )}
          </form>

          {/* Modal Footer with Delete & Save */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-red-600">Delete this task?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Yes, Delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-2 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-transparent hover:border-red-200"
              >
                <Trash2 size={14} />
                <span>Delete Task</span>
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="edit-task-form"
                disabled={isSaving || Boolean(dueDateError)}
                className="px-5 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors shadow-sm cursor-pointer text-sm"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>

        </div>
      </div>

      {breakdownModalOpen && (
        <TaskBreakdownModal
          task={task}
          isOpen={breakdownModalOpen}
          onClose={() => setBreakdownModalOpen(false)}
        />
      )}
    </>
  );
}
