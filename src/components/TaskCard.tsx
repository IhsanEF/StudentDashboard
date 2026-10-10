import React, { useState } from 'react';
import { Task } from '../types';
import { getTaskUrgencyColor, formatVancouverDate, isTaskSnoozed, sanitizeCanvasUrl, TIMEZONE, getTaskUrgencyCategory, parseTaskDueDate, isDateOnly } from '../utils';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import CardMenu from './CardMenu';
import {
  ChevronRight,
  AlertCircle,
  Moon,
  Award,
  ListTree,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  CalendarClock
} from 'lucide-react';
import { addDays, formatDistanceStrict } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import ProgressModal, { formatProgressNoteLine } from './ProgressModal';
import EditTaskModal from './EditTaskModal';
import TaskBreakdownModal from './TaskBreakdownModal';
import { getTaskEstimatedHours } from '../services/workloadService';

const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
  const { updateTask, deleteTask, showToast, now } = useTasksContext();
  const { isSimple } = useViewMode();
  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);

  const urgencyClass = getTaskUrgencyColor(task, now);
  const isRed = urgencyClass.includes('red');
  const isOrange = urgencyClass.includes('orange');
  const isBlue = urgencyClass.includes('blue');
  const isGreen = urgencyClass.includes('green');
  const isPurple = urgencyClass.includes('purple');
  const isTeal = urgencyClass.includes('teal');
  const isAmber = urgencyClass.includes('amber');
  const isSnoozed = isTaskSnoozed(task);

  const handleAction = async (action: string) => {
    const prevStatus = task.status || 'Not Started';
    const prevCheckAgainAt = task.check_again_at || '';

    switch (action) {
      case 'Pending':
      case 'Not Started': {
        if (task.status === 'Not Started') return;
        await updateTask(task.task_id, {
          status: 'Not Started',
          check_again_at: '',
          last_interaction_at: new Date().toISOString()
        });
        showToast({
          message: 'Status changed to To-do',
          undo: async () => {
            await updateTask(task.task_id, {
              status: prevStatus,
              check_again_at: prevCheckAgainAt,
              last_interaction_at: new Date().toISOString()
            });
          }
        });
        break;
      }
      case 'Working': {
        if (task.status === 'Working') return;
        await updateTask(task.task_id, {
          status: 'Working',
          check_again_at: '',
          last_interaction_at: new Date().toISOString()
        });
        showToast({
          message: 'Status changed to Working',
          undo: async () => {
            await updateTask(task.task_id, {
              status: prevStatus,
              check_again_at: prevCheckAgainAt,
              last_interaction_at: new Date().toISOString()
            });
          }
        });
        break;
      }
      case 'Submitted': {
        if (task.status === 'Submitted') return;
        await updateTask(task.task_id, {
          status: 'Submitted',
          check_again_at: '',
          last_interaction_at: new Date().toISOString()
        });
        showToast({
          message: 'Marked as Submitted',
          undo: async () => {
            await updateTask(task.task_id, {
              status: prevStatus,
              check_again_at: prevCheckAgainAt,
              last_interaction_at: new Date().toISOString()
            });
          }
        });
        break;
      }
      case 'Done': {
        if (task.status === 'Done') return;
        await updateTask(task.task_id, {
          status: 'Done',
          check_again_at: '',
          last_interaction_at: new Date().toISOString()
        });
        showToast({
          message: 'Marked as Done',
          undo: async () => {
            await updateTask(task.task_id, {
              status: prevStatus,
              check_again_at: prevCheckAgainAt,
              last_interaction_at: new Date().toISOString()
            });
          }
        });
        break;
      }
      case 'Snooze': {
        const tomorrow = addDays(new Date(), 1);
        const timeStr = formatInTimeZone(tomorrow, TIMEZONE, 'EEE h:mm a');
        await updateTask(task.task_id, {
          check_again_at: tomorrow.toISOString(),
          last_interaction_at: new Date().toISOString()
        });
        showToast({
          message: `Snoozed until ${timeStr}`,
          undo: async () => {
            await updateTask(task.task_id, {
              check_again_at: prevCheckAgainAt,
              last_interaction_at: new Date().toISOString()
            });
          }
        });
        break;
      }
    }
  };

  const handleToggleSubtask = async (subtaskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task.subtasks) return;
    const updatedSubtasks = task.subtasks.map(st =>
      st.id === subtaskId ? { ...st, done: !st.done } : st
    );

    // Auto-promote task to Working if at least one step completed and task is Not Started
    let updatedStatus = task.status;
    const anyDone = updatedSubtasks.some(st => st.done);
    if (anyDone && task.status === 'Not Started') {
      updatedStatus = 'Working';
    }

    await updateTask(task.task_id, {
      subtasks: updatedSubtasks,
      status: updatedStatus,
      ...(updatedStatus === 'Working' ? { check_again_at: '' } : {}),
      last_interaction_at: new Date().toISOString()
    });
  };

  const handleDelete = async () => {
    try {
      await deleteTask(task.task_id);
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  let cardBg = 'bg-white';
  let cardBorder = 'border-slate-200';
  let leftBar = 'bg-slate-300';
  let badgeBg = 'bg-slate-100';
  let badgeText = 'text-slate-700';
  let accentText = 'text-slate-700';

  if (isRed) { cardBg = 'bg-[#fff5f5]'; cardBorder = 'border-red-100'; leftBar = 'bg-red-500'; badgeBg = 'bg-red-100'; badgeText = 'text-red-800'; accentText = 'text-red-800'; }
  else if (isOrange) { cardBg = 'bg-[#fffcf5]'; cardBorder = 'border-orange-100'; leftBar = 'bg-orange-500'; badgeBg = 'bg-orange-100'; badgeText = 'text-orange-800'; accentText = 'text-orange-800'; }
  else if (isBlue) { cardBg = 'bg-[#f5f8ff]'; cardBorder = 'border-blue-100'; leftBar = 'bg-blue-500'; badgeBg = 'bg-blue-100'; badgeText = 'text-blue-800'; accentText = 'text-blue-800'; }
  else if (isGreen) { cardBg = 'bg-white'; cardBorder = 'border-green-200'; leftBar = 'bg-green-500'; badgeBg = 'bg-green-100'; badgeText = 'text-emerald-800'; accentText = 'text-emerald-800'; }
  else if (isPurple) { cardBg = 'bg-[#faf5ff]'; cardBorder = 'border-purple-100'; leftBar = 'bg-purple-500'; badgeBg = 'bg-purple-100'; badgeText = 'text-purple-800'; accentText = 'text-purple-800'; }
  else if (isTeal) { cardBg = 'bg-[#f0fdfa]'; cardBorder = 'border-teal-100'; leftBar = 'bg-teal-500'; badgeBg = 'bg-teal-100'; badgeText = 'text-teal-800'; accentText = 'text-teal-800'; }
  else if (isAmber) { cardBg = 'bg-[#fffbeb]'; cardBorder = 'border-amber-200'; leftBar = 'bg-amber-500'; badgeBg = 'bg-amber-100'; badgeText = 'text-amber-900'; accentText = 'text-amber-900'; }

  const needsReview = task.needs_review === true;
  const hasGrade = Boolean(task.grade_text || (task.points_earned && task.points_possible));

  const subtasksList = task.subtasks || [];
  const completedSubtasksCount = subtasksList.filter(st => st.done).length;
  const totalSubtasksCount = subtasksList.length;
  const subtaskProgressPercent = totalSubtasksCount > 0 ? Math.round((completedSubtasksCount / totalSubtasksCount) * 100) : 0;

  const subtaskTotalHours = React.useMemo(() => {
    if (!task.subtasks || task.subtasks.length === 0) return 0;
    let total = 0;
    for (const st of task.subtasks) {
      if (st.duration) {
        const text = st.duration.toLowerCase();
        const hrMatch = text.match(/([\d.]+)\s*(h|hr|hour)/);
        const minMatch = text.match(/([\d.]+)\s*(m|min)/);
        if (hrMatch) total += parseFloat(hrMatch[1]);
        else if (minMatch) total += parseFloat(minMatch[1]) / 60;
        else total += 1;
      } else {
        total += 1;
      }
    }
    return Math.round(total * 10) / 10;
  }, [task.subtasks]);

  const baseEstimatedHours = Math.round(
    task.estimated_hours ? Number(task.estimated_hours) : getTaskEstimatedHours({ ...task, subtasks: undefined })
  );

  // Title link: only when Canvas URL points at a real page (pathname longer than "/")
  const sanitizedCanvasUrl = sanitizeCanvasUrl(task.canvas_url);
  let hasValidCanvasPath = false;
  let destinationHost = '';
  let isExternalHost = false;
  if (sanitizedCanvasUrl) {
    try {
      const parsed = new URL(sanitizedCanvasUrl);
      const isWebLink = parsed.protocol === 'https:' || parsed.protocol === 'http:';
      hasValidCanvasPath = isWebLink && parsed.pathname.length > 1;
      destinationHost = isWebLink ? parsed.hostname : '';
      isExternalHost = Boolean(destinationHost);
    } catch {
      hasValidCanvasPath = false;
    }
  }

  const isDone = task.status === 'Done' || task.status === 'Submitted';
  const currentStatus = task.status || 'Not Started';
  const dueDate = parseTaskDueDate(task.due_at);
  const dueCategory = getTaskUrgencyCategory(task, now);
  const dueHint = !isDone && dueDate
    ? dueCategory === 'overdue'
      ? `Overdue by ${formatDistanceStrict(dueDate, now)}`
      : dueCategory === 'today'
        ? `Due today${isDateOnly(task.due_at) ? '' : `, ${formatInTimeZone(dueDate, TIMEZONE, 'h:mm a')}`}`
        : ''
    : '';

  return (
    <>
      <div className={`${cardBg} ${cardBorder} border p-5 rounded-2xl relative overflow-hidden flex flex-col h-full shadow-sm hover:shadow-md transition-shadow group`}>
        <div className={`absolute top-0 left-0 w-1 h-full ${leftBar}`}></div>

        <div className="flex justify-between items-start mb-2 gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`px-2 py-1 ${badgeBg} ${badgeText} text-xs font-bold rounded uppercase`}>
              {task.status || 'Not Started'}
            </span>
            {task.type === 'lecture' && (
              <span className="px-2 py-1 bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-bold rounded uppercase">
                Lecture
              </span>
            )}
            {task.type === 'lab' && (
              <span className="px-2 py-1 bg-cyan-50 text-cyan-800 border border-cyan-200 text-xs font-bold rounded uppercase">
                Lab
              </span>
            )}
            {/* Estimated Effort Hours - hidden in Simple mode */}
            {!isSimple && (
              <span
                title="Estimated effort"
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded"
              >
                <Clock size={12} className="text-slate-600" />
                <span>About {baseEstimatedHours} hours</span>
              </span>
            )}
            {needsReview && (
              <span className="inline-flex items-center gap-0.5 px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold rounded">
                <AlertCircle size={12} /> Check date
              </span>
            )}
            {isSnoozed && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-200/90 text-slate-800 text-xs font-semibold rounded">
                <Moon size={12} />
                <span>Snoozed until {formatInTimeZone(new Date(task.check_again_at), TIMEZONE, 'EEE h:mm a')}</span>
                <span>—</span>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await updateTask(task.task_id, {
                      check_again_at: '',
                      last_interaction_at: new Date().toISOString()
                    });
                  }}
                  className="underline hover:text-slate-900 cursor-pointer font-bold py-1.5 px-2 min-h-[24px] inline-flex items-center"
                >
                  Undo
                </button>
              </span>
            )}
            {task.is_syllabus_only && (
              <span
                title="This task was extracted from your course syllabus and was added from a course outline"
                className="inline-flex items-center gap-0.5 px-2 py-1 bg-sky-50 text-sky-900 border border-sky-200 text-xs font-semibold rounded"
              >
                From course outline
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
              {task.course}
            </span>
          </div>
        </div>

        {/* Title: link only if Canvas URL points at a real page */}
        {hasValidCanvasPath ? (
          <a
            href={sanitizedCanvasUrl}
            title={`${isExternalHost ? 'External' : 'Resource'}: ${destinationHost}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-slate-800 hover:text-blue-600 transition-colors line-clamp-1 mb-1 block"
          >
            {task.title}
          </a>
        ) : (
          <h4 className="font-bold text-slate-800 line-clamp-1 mb-1">
            {task.title}
          </h4>
        )}

        {destinationHost && (
          <a href={sanitizedCanvasUrl} target="_blank" rel="noopener noreferrer"
            title={`Destination: ${destinationHost}`} className="text-xs text-blue-700 hover:underline mb-2 break-all">
            {isExternalHost ? 'External' : 'Resource'} · {destinationHost}
          </a>
        )}

        {task.source_message_id && (
          <span title={`Source message: ${task.source_message_id}`} className="text-xs text-slate-600 mb-2">
            From email
          </span>
        )}

        {/* One-line summary - hidden in Simple mode */}
        {!isSimple && (
          <p className="text-xs text-slate-600 mb-3 line-clamp-1">
            {task.summary || "No summary provided."}
          </p>
        )}

        {/* Imported date Conflict Alert Pill */}
        {task.canvas_date_diff && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mb-3 flex items-start justify-between gap-2 text-xs">
            <div className="flex items-start gap-1.5 text-amber-950">
              <CalendarClock size={16} className="text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block text-amber-950">Imported date changed</span>
                <span className="text-xs text-amber-900">
                  New: {formatVancouverDate(task.canvas_date_diff.newDueDate)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className="px-3 py-2 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold rounded text-xs transition-colors cursor-pointer shrink-0 min-h-[32px] inline-flex items-center"
            >
              Review
            </button>
          </div>
        )}

        {/* Score / Grade pill if graded */}
        {hasGrade && (
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg mb-3 w-fit">
            <Award size={14} />
            <span>
              {task.grade_text ? task.grade_text : ''}
              {task.points_earned && task.points_possible ? ` (${task.points_earned}/${task.points_possible} pts)` : ''}
            </span>
          </div>
        )}

        {/* Actionable Subtasks Section - collapsed behind chip in detailed view */}
        {!isSimple && totalSubtasksCount > 0 && (
          <div className="mb-3">
            {!isSubtasksExpanded ? (
              <button
                type="button"
                onClick={() => setIsSubtasksExpanded(true)}
                aria-expanded={isSubtasksExpanded}
                aria-controls={`subtasks-${task.task_id}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[32px] bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <ListTree size={14} className="text-indigo-700" />
                <span>Steps ({completedSubtasksCount} of {totalSubtasksCount}){subtaskTotalHours > 0 ? ` (${subtaskTotalHours}h total)` : ''}</span>
                <ChevronDown size={14} />
              </button>
            ) : (
              <div id={`subtasks-${task.task_id}`} className="bg-slate-50/90 border border-slate-200/90 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setIsSubtasksExpanded(false)}
                    aria-expanded={isSubtasksExpanded}
                    aria-controls={`subtasks-${task.task_id}`}
                    className="font-bold text-slate-800 flex items-center gap-1.5 hover:text-blue-700 transition-colors cursor-pointer text-left min-h-[32px] py-1"
                  >
                    <ListTree size={14} className="text-indigo-700" />
                    <span>Steps ({completedSubtasksCount} of {totalSubtasksCount})</span>
                    <ChevronUp size={14} />
                  </button>
                  <div className="flex items-center gap-2">
                    {subtaskTotalHours > 0 && (
                      <span className="text-xs text-slate-500 font-medium">
                        {subtaskTotalHours}h total
                      </span>
                    )}
                    <span className="text-xs font-bold text-indigo-800 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                      {subtaskProgressPercent}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setBreakdownModalOpen(true)}
                      className="text-xs font-semibold text-slate-600 hover:text-indigo-700 hover:underline cursor-pointer py-2 px-2.5 min-h-[28px] inline-flex items-center"
                    >
                      Edit steps
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${subtaskProgressPercent}%` }}
                  />
                </div>

                {/* Collapsible checklist items */}
                <div className="pt-2 space-y-2 border-t border-slate-200/60 animate-in fade-in">
                  {subtasksList.map((st) => (
                    <div
                      key={st.id}
                      onClick={(e) => handleToggleSubtask(st.id, e)}
                      className="flex items-start gap-2.5 text-xs p-2 rounded-lg hover:bg-white transition-colors cursor-pointer group/step min-h-[36px]"
                    >
                      <button
                        type="button"
                        className="mt-0.5 p-2.5 -m-2 text-slate-500 hover:text-emerald-700 shrink-0 cursor-pointer min-w-[24px] min-h-[24px] flex items-center justify-center"
                        aria-label={st.done ? `Mark "${st.title}" incomplete` : `Mark "${st.title}" complete`}
                      >
                        {st.done ? (
                          <CheckCircle2 size={18} className="text-emerald-700 fill-emerald-50" />
                        ) : (
                          <Circle size={18} className="text-slate-500 group-hover/step:text-blue-600" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium line-clamp-1 ${st.done ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                          {st.title}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-600 mt-0.5">
                          {st.startDate && (
                            <span className="flex items-center gap-0.5">
                              <Calendar size={11} className="text-slate-500" /> Start {formatVancouverDate(st.startDate)}
                            </span>
                          )}
                          {st.doByDate && (
                            <span className="flex items-center gap-0.5 text-blue-700 font-semibold">
                              Do by {formatVancouverDate(st.doByDate)}
                            </span>
                          )}
                          {st.duration && (
                            <span className="flex items-center gap-0.5 text-amber-900 bg-amber-50 px-1 rounded border border-amber-200 font-medium ml-auto">
                              <Clock size={10} /> {st.duration}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(task.next_action || task.progress_notes) && (
          <div className="bg-white/50 rounded-xl p-3 border border-slate-100/50 space-y-2 mb-4 text-xs text-slate-700">
            {task.next_action && (
              <div className="flex items-start gap-1 font-medium">
                <ChevronRight size={14} className="text-blue-600 shrink-0" />
                <span>{task.next_action}</span>
              </div>
            )}
            {task.progress_notes && (
              <p className="line-clamp-2 border-l-2 border-slate-300 pl-2 text-slate-700">
                {formatProgressNoteLine(task.progress_notes.split('\n').pop() || '')}
              </p>
            )}
          </div>
        )}

        {/* Footer: Fixed 4 segmented options (To-do / Working / Submitted / Done) with current selected, plus CardMenu */}
        <div className="mt-auto border-t border-slate-200/60 pt-3 flex flex-col gap-2">
          {task.due_at && (
            <div className={`text-xs font-semibold italic ${accentText}`}>
              Due {formatVancouverDate(task.due_at)}
              {dueHint && <span className="block mt-0.5">{dueHint}</span>}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div
              role="group"
              aria-label="Task status"
              className="grid grid-cols-4 gap-1 flex-1 bg-slate-100 p-1 rounded-lg border border-slate-200"
            >
              <button
                type="button"
                onClick={() => handleAction('Not Started')}
                disabled={currentStatus === 'Not Started'}
                aria-pressed={currentStatus === 'Not Started'}
                aria-label={`Mark "${task.title}" as to-do`}
                className={`min-h-[36px] cursor-pointer text-center flex items-center justify-center text-xs font-semibold rounded-md px-1.5 py-1.5 transition-all ${
                  currentStatus === 'Not Started'
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-300 font-bold opacity-100 cursor-default'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                To-do
              </button>
              <button
                type="button"
                onClick={() => handleAction('Working')}
                disabled={currentStatus === 'Working'}
                aria-pressed={currentStatus === 'Working'}
                aria-label={`Mark "${task.title}" as working`}
                className={`min-h-[36px] cursor-pointer text-center flex items-center justify-center text-xs font-semibold rounded-md px-1.5 py-1.5 transition-all ${
                  currentStatus === 'Working'
                    ? 'bg-amber-600 text-white shadow-sm font-bold opacity-100 cursor-default'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                Working
              </button>
              <button
                type="button"
                onClick={() => handleAction('Submitted')}
                disabled={currentStatus === 'Submitted'}
                aria-pressed={currentStatus === 'Submitted'}
                aria-label={`Mark "${task.title}" as submitted`}
                className={`min-h-[36px] cursor-pointer text-center flex items-center justify-center text-xs font-semibold rounded-md px-1.5 py-1.5 transition-all ${
                  currentStatus === 'Submitted'
                    ? 'bg-blue-600 text-white shadow-sm font-bold opacity-100 cursor-default'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                Submitted
              </button>
              <button
                type="button"
                onClick={() => handleAction('Done')}
                disabled={currentStatus === 'Done'}
                aria-pressed={currentStatus === 'Done'}
                aria-label={`Mark "${task.title}" as done`}
                className={`min-h-[36px] cursor-pointer text-center flex items-center justify-center text-xs font-semibold rounded-md px-1.5 py-1.5 transition-all ${
                  currentStatus === 'Done'
                    ? 'bg-slate-900 text-white shadow-sm font-bold opacity-100 cursor-default'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                }`}
              >
                Done
              </button>
            </div>
            <CardMenu
              task={task}
              onEdit={() => setEditModalOpen(true)}
              onMarkSubmitted={() => handleAction('Submitted')}
              onHideUntilTomorrow={isDone ? undefined : () => handleAction('Snooze')}
              onAddNote={() => setModalOpen(true)}
              onBreakIntoSteps={() => setBreakdownModalOpen(true)}
              onDelete={handleDelete}
            />
          </div>
        </div>
      </div>

      {modalOpen && <ProgressModal task={task} onClose={() => setModalOpen(false)} />}
      {editModalOpen && <EditTaskModal task={task} isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} />}
      {breakdownModalOpen && (
        <TaskBreakdownModal
          task={task}
          isOpen={breakdownModalOpen}
          onClose={() => setBreakdownModalOpen(false)}
        />
      )}
    </>
  );
};

export default TaskCard;


