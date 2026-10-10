import React, { useState, useEffect } from 'react';
import { deleteField } from 'firebase/firestore';
import { auth } from '../auth';
import { useTasksContext } from '../hooks/useTasks';
import { Task, CalendarDateDiff } from '../types';
import { useModalFocus } from '../hooks/useModalFocus';
import {
  Inbox,
  X,
  Check,
  CheckCircle2,
  Calendar,
  Clock,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Trash2,
  RefreshCw,
  Edit3,
  ShieldCheck,
  CalendarCheck2
} from 'lucide-react';
import { formatReadableDate, getCourseColor, canvasLinkReviewWarning } from '../utils';

/**
 * Helper to identify pure recurring lectures, tutorials, or non-gradable class meetings
 * from Canvas feeds that should not pollute actionable review queues (V3-374).
 */
export function isCanvasClassOrLecture(task: {
  type?: string;
  title?: string;
  points_possible?: string;
}): boolean {
  if (task.type === 'lecture') return true;
  if (task.type === 'lab' && (!task.points_possible || task.points_possible === '0')) return true;

  const title = (task.title || '').trim().toLowerCase();

  // Guard: if it's an assessment/deliverable with points or keywords, do not treat as a schedule event
  const isAssessment = /\b(quiz|exam|midterm|final|assignment|project|paper|essay|homework|problem set|submission)\b/i.test(title);
  if (isAssessment) return false;
  if (task.points_possible && parseFloat(task.points_possible) > 0) return false;

  if (
    title.startsWith('lecture') ||
    title.startsWith('class') ||
    title.startsWith('tutorial') ||
    title.startsWith('office hour') ||
    /\b(lecture|class meeting|recurring class|tutorial meeting|lab meeting)\b/i.test(title)
  ) {
    return true;
  }

  return false;
}

interface ReviewInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEditTask?: (task: Task) => void;
}

export default function ReviewInboxModal({ isOpen, onClose, onEditTask }: ReviewInboxModalProps) {
  const {
    tasks,
    isDemoMode,
    updateTask,
    deleteTask,
    dismissReviewTasks,
    batchAddTasks,
    notificationPrefs,
    updateNotificationPrefs,
    refreshTasks
  } = useTasksContext();

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  // Items needing review (new deliverables or imported items, excluding pure schedule/lecture meetings per V3-374)
  const itemsNeedingReview = tasks.filter(t => !t.demo_seed && t.needs_review && !isCanvasClassOrLecture(t));
  // Tasks with flagged date discrepancies from Canvas
  const tasksWithDateDiffs = tasks.filter(t => !t.demo_seed && !!t.canvas_date_diff);

  const totalPendingReviews = itemsNeedingReview.length + tasksWithDateDiffs.length;

  // Clean up any legacy lecture/class meeting tasks with needs_review when modal is opened (V3-374 & V3-153)
  useEffect(() => {
    if (!isOpen) return;
    const lectureTasksToClean = tasks.filter(t => !t.demo_seed && t.needs_review && isCanvasClassOrLecture(t));
    if (lectureTasksToClean.length > 0) {
      const idsToDismiss = lectureTasksToClean.map(t => t.task_id);
      const currentDismissed = new Set(notificationPrefs?.dismissedCanvasIds || []);
      idsToDismiss.forEach(id => currentDismissed.add(id));
      updateNotificationPrefs({
        ...notificationPrefs,
        dismissedCanvasIds: Array.from(currentDismissed)
      }).catch(err => console.warn('Failed to persist dismissedCanvasIds:', err));

      if (dismissReviewTasks) {
        dismissReviewTasks(idsToDismiss).catch(err => console.warn('Failed to dismiss review tasks:', err));
      } else {
        idsToDismiss.forEach(id => deleteTask(id).catch(err => console.warn('Failed to delete task:', err)));
      }
    }
  }, [isOpen, tasks]);

  if (!isOpen) return null;

  // Toggle single item selection
  const toggleSelect = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // Toggle select all items needing review
  const handleSelectAll = () => {
    if (selectedTaskIds.size === itemsNeedingReview.length && itemsNeedingReview.length > 0) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(itemsNeedingReview.map(t => t.task_id)));
    }
  };

  // Accept a single new item
  const handleAcceptItem = async (taskId: string) => {
    setActionError(null);
    try {
      await updateTask(taskId, {
        needs_review: false,
        last_interaction_at: new Date().toISOString()
      });
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    } catch (err: any) {
      console.error('Failed to accept item:', err);
      setActionError(err?.message || 'Failed to accept item');
    }
  };

  // Reject / delete a newly suggested item and tombstone it (V3-153)
  const handleDismissItem = async (taskId: string) => {
    setActionError(null);
    try {
      const currentDismissed = new Set(notificationPrefs?.dismissedCanvasIds || []);
      currentDismissed.add(taskId);
      await updateNotificationPrefs({
        ...notificationPrefs,
        dismissedCanvasIds: Array.from(currentDismissed)
      });

      if (dismissReviewTasks) {
        await dismissReviewTasks([taskId]);
      } else {
        await deleteTask(taskId);
      }
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    } catch (err: any) {
      console.error('Failed to dismiss item:', err);
      setActionError(err?.message || 'Failed to dismiss item');
    }
  };

  // Dismiss all pending items needing review and tombstone them (V3-153)
  const handleDismissAll = async () => {
    setActionError(null);
    try {
      const ids = itemsNeedingReview.map(t => t.task_id);
      const currentDismissed = new Set(notificationPrefs?.dismissedCanvasIds || []);
      ids.forEach(id => currentDismissed.add(id));
      await updateNotificationPrefs({
        ...notificationPrefs,
        dismissedCanvasIds: Array.from(currentDismissed)
      });

      if (dismissReviewTasks) {
        await dismissReviewTasks(ids);
      } else {
        for (const item of itemsNeedingReview) {
          await deleteTask(item.task_id);
        }
      }
      setSelectedTaskIds(new Set());
      setSyncStatusMsg('All review items dismissed and tombstoned.');
      setTimeout(() => setSyncStatusMsg(null), 3000);
    } catch (err: any) {
      console.error('Failed to dismiss all items:', err);
      setActionError(err?.message || 'Failed to dismiss all items');
    }
  };

  // Dismiss selected items and tombstone them (V3-153)
  const handleDismissSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    setActionError(null);
    try {
      const ids = Array.from(selectedTaskIds);
      const currentDismissed = new Set(notificationPrefs?.dismissedCanvasIds || []);
      ids.forEach(id => currentDismissed.add(id));
      await updateNotificationPrefs({
        ...notificationPrefs,
        dismissedCanvasIds: Array.from(currentDismissed)
      });

      if (dismissReviewTasks) {
        await dismissReviewTasks(ids);
      } else {
        for (const id of ids) {
          await deleteTask(id);
        }
      }
      setSelectedTaskIds(new Set());
      setSyncStatusMsg(`Dismissed ${ids.length} selected ${ids.length === 1 ? 'item' : 'items'}.`);
      setTimeout(() => setSyncStatusMsg(null), 3000);
    } catch (err: any) {
      console.error('Failed to dismiss selected items:', err);
      setActionError(err?.message || 'Failed to dismiss selected items');
    }
  };

  // Accept selected items
  const handleAcceptSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    setActionError(null);
    try {
      for (const id of selectedTaskIds) {
        await updateTask(id, {
          needs_review: false,
          last_interaction_at: new Date().toISOString()
        });
      }
      const count = selectedTaskIds.size;
      setSelectedTaskIds(new Set());
      setSyncStatusMsg(`Confirmed ${count} ${count === 1 ? 'item' : 'items'}!`);
      setTimeout(() => setSyncStatusMsg(null), 3000);
    } catch (err: any) {
      console.error('Failed to accept selected items:', err);
      setActionError(err?.message || 'Failed to accept selected items');
    }
  };

  // Accept all pending reviews
  const handleAcceptAll = async () => {
    setActionError(null);
    try {
      for (const item of itemsNeedingReview) {
        await updateTask(item.task_id, {
          needs_review: false,
          last_interaction_at: new Date().toISOString()
        });
      }
      for (const item of tasksWithDateDiffs) {
        if (item.canvas_date_diff) {
          await updateTask(item.task_id, {
            due_at: item.canvas_date_diff.newDueDate,
            canvas_date_diff: deleteField() as any,
            last_interaction_at: new Date().toISOString()
          });
        }
      }
      setSelectedTaskIds(new Set());
      setSyncStatusMsg('All items confirmed and synchronized!');
      setTimeout(() => setSyncStatusMsg(null), 3000);
    } catch (err: any) {
      console.error('Failed to accept all items:', err);
      setActionError(err?.message || 'Failed to confirm all items');
    }
  };

  // Apply a Canvas date change
  const handleApplyCanvasDate = async (task: Task) => {
    if (!task.canvas_date_diff) return;
    setActionError(null);
    try {
      await updateTask(task.task_id, {
        due_at: task.canvas_date_diff.newDueDate,
        canvas_date_diff: deleteField() as any,
        last_interaction_at: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('Failed to apply Canvas date:', err);
      setActionError(err?.message || 'Failed to update date');
    }
  };

  // Keep student hand-set date (ignore Canvas date update)
  const handleKeepStudentDate = async (task: Task) => {
    setActionError(null);
    try {
      await updateTask(task.task_id, {
        canvas_date_diff: deleteField() as any,
        last_interaction_at: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('Failed to keep student date:', err);
      setActionError(err?.message || 'Failed to dismiss date change');
    }
  };

  // Trigger manual background sync with saved feed URL


  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-inbox-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
              <Inbox size={20} />
            </div>
            <div>
              <h2 id="review-inbox-title" className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Check imported items</span>
                {totalPendingReviews > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                    {totalPendingReviews} pending
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500">
                Your notes and edited dates are never overwritten
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">

            <button
              onClick={onClose}
              aria-label="Close imported items review"
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>



        {/* Status Message */}
        {syncStatusMsg && (
          <div role="status" className="bg-blue-50 border-b border-blue-100 px-5 py-2.5 text-xs font-semibold text-blue-800 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-blue-600" />
            <span>{syncStatusMsg}</span>
          </div>
        )}

        {/* Action Error Message */}
        {actionError && (
          <div role="alert" className="bg-red-50 border-b border-red-100 px-5 py-2.5 text-xs font-semibold text-red-800 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-600" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/30">
          {totalPendingReviews === 0 ? (
            <div className="p-12 text-center space-y-3 bg-white rounded-2xl border border-slate-200">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="text-base font-bold text-slate-800">Nothing to check.</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No new items or date changes pending review.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Section 1: Date Discrepancies */}
              {tasksWithDateDiffs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <AlertCircle size={14} className="text-amber-500" />
                      <span>Imported date updates ({tasksWithDateDiffs.length})</span>
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      An imported document updated these deadlines
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {tasksWithDateDiffs.map(task => {
                      const diff = task.canvas_date_diff!;
                      const courseColor = getCourseColor(task.course);

                      return (
                        <div
                          key={task.task_id}
                          className="bg-white border border-amber-200 rounded-xl p-4 shadow-xs space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span className={`text-xs font-bold px-2 py-1 rounded-lg shrink-0 border ${courseColor}`}>
                                {task.course}
                              </span>
                              <div className="min-w-0 flex-1">
                                <h4 className="text-sm font-bold text-slate-900 truncate">{task.title}</h4>
                              {canvasLinkReviewWarning(task.canvas_url) && (
                                <p role="note" className="text-xs text-amber-800 mt-1">{canvasLinkReviewWarning(task.canvas_url)}</p>
                              )}
                                <p className="text-xs text-slate-500 mt-0.5">
                                  Current in dashboard: <strong className="text-slate-700">{formatReadableDate(diff.oldDueDate)}</strong>
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => handleApplyCanvasDate(task)}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Check size={13} />
                                <span>Use imported date</span>
                              </button>
                              <button
                                onClick={() => handleKeepStudentDate(task)}
                                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>

                          {/* Date Diff Indicator */}
                          <div className="bg-amber-50/80 border border-amber-200/80 rounded-lg p-2.5 flex items-center gap-3 text-xs text-amber-900">
                            <span className="line-through text-slate-400 font-medium">
                              {formatReadableDate(diff.oldDueDate)}
                            </span>
                            <ArrowRight size={14} className="text-amber-600" />
                            <span className="font-bold text-blue-700 flex items-center gap-1">
                              <CalendarCheck2 size={13} />
                              New imported deadline: {formatReadableDate(diff.newDueDate)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 2: New Tasks to Confirm */}
              {itemsNeedingReview.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles size={14} className="text-indigo-600" />
                      <span>New tasks to confirm ({itemsNeedingReview.length})</span>
                    </h3>
                  </div>

                  <div className="space-y-2.5">
                    {itemsNeedingReview.map(task => {
                      const courseColor = getCourseColor(task.course);

                      return (
                        <div
                          key={task.task_id}
                          className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg shrink-0 border ${courseColor}`}>
                              {task.course}
                            </span>
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-bold text-slate-900 truncate">{task.title}</h4>
                              {canvasLinkReviewWarning(task.canvas_url) && (
                                <p role="note" className="text-xs text-amber-800 mt-1">{canvasLinkReviewWarning(task.canvas_url)}</p>
                              )}
                              <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                                <span className="flex items-center gap-1 font-medium">
                                  <Calendar size={12} className="text-slate-400" />
                                  {task.due_at ? formatReadableDate(task.due_at) : 'No due date'}
                                </span>
                                {task.source && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase font-semibold">
                                    {task.source}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>

                          {/* Item Actions: Confirm & Dismiss */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleAcceptItem(task.task_id)}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Check size={13} />
                              <span>Confirm</span>
                            </button>
                            {onEditTask && (
                              <button
                                onClick={() => onEditTask(task)}
                                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                title="Edit task before confirming"
                                aria-label={`Edit ${task.title} before confirming`}
                              >
                                <Edit3 size={15} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDismissItem(task.task_id)}
                              aria-label={`Dismiss ${task.title}`}
                              className="ml-4 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                              title="Remove this item"
                            >
                              <span>Dismiss</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: Single Confirm All bulk button + Dismiss all + Close */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
          <div>
            {itemsNeedingReview.length > 1 && (
              <button
                onClick={handleDismissAll}
                className="px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100/70 border border-rose-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Dismiss all</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {totalPendingReviews > 0 && (
              <button
                onClick={handleAcceptAll}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 size={14} />
                <span>Confirm all ({totalPendingReviews})</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
