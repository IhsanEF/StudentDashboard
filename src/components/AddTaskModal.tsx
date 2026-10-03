import TaskFields, { validateTaskIdentity, taskSaveError } from './TaskFields';
import React, { useState, useEffect, useRef } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import { checkDateWorkloadImpact } from '../services/workloadService';
import { useModalFocus } from '../hooks/useModalFocus';
import { Task, TaskType, TaskStatus } from '../types';
import { getAuthHeader } from '../auth';
import { Sparkles, Check, X, AlertCircle, ChevronDown } from 'lucide-react';
import { formatInTimeZone, TIMEZONE, toVancouverDateString, toVancouverISO, parseTaskDueDate } from '../utils';

interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialText?: string;
  defaultCourse?: string;
}

export interface QuickAddDraft {
  title: string;
  course: string;
  type: TaskType;
  due_at: string; // YYYY-MM-DDTHH:mm or YYYY-MM-DD
  dateUnrecognised: boolean;
  estimated_hours?: number;
  weight?: number;
  points_possible?: string;
  summary?: string;
}

export const generateLocalDraft = (text: string): QuickAddDraft => {
  const lower = text.toLowerCase();
  
  // Course match
  let course = 'General';
  const courseMatch = text.match(/\b([A-Z]{2,4}\s*\d{3}[A-Z]?)\b/i);
  if (courseMatch) {
    course = courseMatch[1].toUpperCase();
  }

  // Type match
  let type: TaskType = 'assignment';
  if (lower.includes('lab')) type = 'lab';
  else if (lower.includes('quiz') || lower.includes('test')) type = 'quiz';
  else if (lower.includes('exam') || lower.includes('midterm') || lower.includes('final')) type = 'exam';
  else if (lower.includes('project') || lower.includes('milestone')) type = 'project';
  else if (lower.includes('reading') || lower.includes('read') || lower.includes('chapter')) type = 'reading';
  else if (lower.includes('lecture')) type = 'lecture';
  else if (lower.includes('announcement')) type = 'announcement';

  // Hours match
  let hours = 3;
  const hoursMatch = text.match(/(?:~|\b)?(\d+(?:\.\d+)?)\s*(?:h|hrs|hours)\b/i);
  if (hoursMatch) hours = parseFloat(hoursMatch[1]);

  // Weight match (% or worth X%)
  let weight = 0;
  const weightMatch = text.match(/worth\s+(\d+(?:\.\d+)?)\s*%?/i) || text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (weightMatch) weight = parseFloat(weightMatch[1]);

  // Specific time match (e.g. "at 5pm", "11:59pm", "17:00")
  let targetTime = '23:59';
  const timeMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    targetTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // Parse date in Vancouver timezone
  const todayVanStr = toVancouverDateString(new Date()); // 'YYYY-MM-DD'
  const [tY, tM, tD] = todayVanStr.split('-').map(Number);
  const nowVan = new Date(Date.UTC(tY, tM - 1, tD, 12, 0, 0));

  let resolvedDueDate = '';

  if (/\byesterday\b/i.test(lower)) {
    const yesterday = new Date(nowVan.getTime() - 24 * 60 * 60 * 1000);
    resolvedDueDate = toVancouverDateString(yesterday);
  } else if (/\b(\d{1,5})\s+days?\s+ago\b/i.test(lower)) {
    const match = lower.match(/\b(\d{1,5})\s+days?\s+ago\b/i);
    if (match) {
      const d = parseInt(match[1], 10);
      const target = new Date(nowVan.getTime() - d * 24 * 60 * 60 * 1000);
      resolvedDueDate = toVancouverDateString(target);
    }
  } else if (/\b(\d{1,5})\s+weeks?\s+ago\b/i.test(lower)) {
    const match = lower.match(/\b(\d{1,5})\s+weeks?\s+ago\b/i);
    if (match) {
      const w = parseInt(match[1], 10);
      const target = new Date(nowVan.getTime() - w * 7 * 24 * 60 * 60 * 1000);
      resolvedDueDate = toVancouverDateString(target);
    }
  } else if (/\btoday\b/i.test(lower)) {
    resolvedDueDate = todayVanStr;
  } else if (/\b(tomorrow|tmrw)\b/i.test(lower)) {
    const target = new Date(nowVan.getTime() + 24 * 60 * 60 * 1000);
    resolvedDueDate = toVancouverDateString(target);
  } else if (/\bin\s+(\d{1,5})\s+days?\b/i.test(lower)) {
    const match = lower.match(/\bin\s+(\d{1,5})\s+days?\b/i);
    if (match) {
      const d = parseInt(match[1], 10);
      const target = new Date(nowVan.getTime() + d * 24 * 60 * 60 * 1000);
      resolvedDueDate = toVancouverDateString(target);
    }
  } else if (/\bin\s+(\d{1,5})\s+weeks?\b/i.test(lower)) {
    const match = lower.match(/\bin\s+(\d{1,5})\s+weeks?\b/i);
    if (match) {
      const w = parseInt(match[1], 10);
      const target = new Date(nowVan.getTime() + w * 7 * 24 * 60 * 60 * 1000);
      resolvedDueDate = toVancouverDateString(target);
    }
  } else {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const shortDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (let i = 0; i < 7; i++) {
      const dName = dayNames[i];
      const sName = shortDays[i];
      const dayRegex = new RegExp(`\\b(${dName}|${sName})\\b`, 'i');
      if (dayRegex.test(lower)) {
        const currentDay = nowVan.getUTCDay();
        let diff = i - currentDay;
        if (/\blast\b/i.test(lower)) {
          diff = diff >= 0 ? diff - 7 : diff;
        } else if (/\bnext\b/i.test(lower)) {
          diff += 7;
        } else {
          if (diff <= 0) diff += 7;
        }
        const target = new Date(nowVan.getTime() + diff * 24 * 60 * 60 * 1000);
        resolvedDueDate = toVancouverDateString(target);
        break;
      }
    }
  }

  if (!resolvedDueDate) {
    const monthMatch = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
    if (monthMatch) {
      const monthStr = monthMatch[1].slice(0, 3).toLowerCase();
      const dayNum = parseInt(monthMatch[2], 10);
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const mIdx = months.indexOf(monthStr);
      if (mIdx !== -1) {
        let targetYear = tY;
        if (mIdx < tM - 1) targetYear += 1;
        const mm = String(mIdx + 1).padStart(2, '0');
        const dd = String(dayNum).padStart(2, '0');
        resolvedDueDate = `${targetYear}-${mm}-${dd}`;
      }
    }
  }

  const candidateDue = resolvedDueDate ? `${resolvedDueDate}T${targetTime}` : '';
  const parsedDue = parseTaskDueDate(candidateDue);
  const dateUnrecognised = !parsedDue || parsedDue.getTime() < Date.now();
  const fullDateTime = dateUnrecognised ? '' : candidateDue;

  // Clean title: remove due clauses, hours, weights
  let cleanTitle = text
    .replace(/due\s+(?:next\s+|this\s+|last\s+)?[a-z0-9\s,]+?(?=\s*(?:~|\b\d+h|worth|\d+%)|$)/i, '')
    .replace(/~?\d+(?:\.\d+)?\s*(?:h|hrs|hours)\b/i, '')
    .replace(/worth\s+\d+(?:\.\d+)?\s*%?/i, '')
    .replace(/\d+(?:\.\d+)?%/g, '')
    .trim();

  // Clean leading/trailing punctuation or connectors
  cleanTitle = cleanTitle.replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '').trim();

  if (!cleanTitle || cleanTitle.length < 3) {
    cleanTitle = `${course} ${type.charAt(0).toUpperCase() + type.slice(1)}`;
  }

  return {
    title: cleanTitle,
    course,
    type,
    due_at: fullDateTime,
    dateUnrecognised,
    estimated_hours: hours,
    weight: weight > 0 ? weight : undefined,
    // Explicitly do NOT write the typed sentence into description/summary
    summary: ''
  };
};

export default function AddTaskModal({
  isOpen,
  onClose,
  initialText = '',
  defaultCourse = ''
}: AddTaskModalProps) {
  const { addTask, isDemoMode, courses, tasks, showToast, notificationPrefs } = useTasksContext();
  const { isSimple } = useViewMode();
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  // Quick Add "Describe it in one sentence" top input
  const [sentenceInput, setSentenceInput] = useState(initialText);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dateUnrecognised, setDateUnrecognised] = useState(false);

  // Manual fields below
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState(defaultCourse || 'General');
  const [type, setType] = useState<TaskType>('assignment');
  const [dueAt, setDueAt] = useState('');
  const [status, setStatus] = useState<TaskStatus>('Not Started');
  const [notes, setNotes] = useState('');
  const [estimatedHours, setEstimatedHours] = useState<number | ''>(3);
  const [weight, setWeight] = useState<string | number>('');

  // Detailed view disclosure fields
  const [pointsEarned, setPointsEarned] = useState('');
  const [pointsPossible, setPointsPossible] = useState('');
  const [gradeText, setGradeText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [canvasUrl, setCanvasUrl] = useState('');

  // Save state & Toast
  const [identityErrors, setIdentityErrors] = useState({ title: '', course: '' });
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const [isFallbackActive, setIsFallbackActive] = useState(false);

  const sentenceInputRef = useRef<HTMLInputElement>(null);

  // Collect available courses for datalist
  const courseOptions = Array.from(
    new Set([
      ...(courses || []).map(c => c.course_code),
      ...(tasks || []).map(t => t.course)
    ])
  ).filter(Boolean);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setSentenceInput(initialText);
      setIsParsing(false);
      setParseError(null);
      setDateUnrecognised(false);
      setTitle('');
      setIdentityErrors({ title: '', course: '' });
      setCourse(defaultCourse || (courseOptions[0] || 'General'));
      setType('assignment');
      
      // Default to today at 23:59 in Vancouver
      const todayVan = toVancouverDateString(new Date());
      setDueAt(`${todayVan}T23:59`);
      
      setStatus('Not Started');
      setNotes('');
      setEstimatedHours(3);
      setWeight('');
      setPointsEarned('');
      setPointsPossible('');
      setGradeText('');
      setFeedback('');
      setCanvasUrl('');
      setIsSaving(false);
      setIsFallbackActive(false);

      setTimeout(() => {
        sentenceInputRef.current?.focus();
      }, 60);
    }
  }, [isOpen, initialText, defaultCourse]);

  // Quick Add parser handler
  const handleParseSentence = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = sentenceInput.trim();
    if (!text) return;

    setIsParsing(true);
    setParseError(null);

    try {
      if (isDemoMode) {
        // Deterministic local heuristic parser in demo mode
        const draft = generateLocalDraft(text);
        applyParsedDraft(draft, true);
        return;
      }

      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/ai/quick-add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      if (data?.task) {
        const taskData = data.task;
        let formattedDue = taskData.due_at || '';
        if (formattedDue && !formattedDue.includes('T')) {
          formattedDue = `${formattedDue}T23:59`;
        }

        const draft: QuickAddDraft = {
          title: taskData.title || text,
          course: taskData.course || course,
          type: (taskData.type as TaskType) || type,
          due_at: formattedDue,
          dateUnrecognised: !formattedDue || !!taskData.dateUnrecognised,
          estimated_hours: taskData.estimated_hours || 3,
          weight: typeof taskData.weight_percent === 'number'
            ? taskData.weight_percent
            : (taskData.weight ? parseFloat(taskData.weight) : undefined),
          // Do not write typed sentence into description
          summary: ''
        };
        applyParsedDraft(draft, data.source === 'heuristic');
      } else {
        throw new Error('No task returned from parser');
      }
    } catch (err: any) {
      console.warn('AI Quick-add parser failed, falling back to local heuristic:', err);
      const draft = generateLocalDraft(text);
      applyParsedDraft(draft, true);
    } finally {
      setIsParsing(false);
    }
  };

  const applyParsedDraft = (draft: QuickAddDraft, isFallback = false) => {
    setIsFallbackActive(isFallback);
    if (draft.title) setTitle(draft.title);
    if (draft.course) setCourse(draft.course);
    if (draft.type) setType(draft.type);
    
    const parsedDue = parseTaskDueDate(draft.due_at);
    const needsDate = draft.dateUnrecognised || !parsedDue || parsedDue.getTime() < Date.now();
    setDueAt(needsDate ? '' : formatInTimeZone(parsedDue!, TIMEZONE, "yyyy-MM-dd'T'HH:mm"));
    setDateUnrecognised(needsDate);

    if (draft.estimated_hours) setEstimatedHours(draft.estimated_hours);

    // Store a weight as weight, never as Points Possible
    setWeight(typeof draft.weight === 'number' && Number.isFinite(draft.weight)
      ? Math.max(0, Math.min(100, draft.weight)) : '');
    // Do NOT write the typed sentence into description or notes
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveInFlightRef.current) return;
    const errors = validateTaskIdentity(title, course);
    setIdentityErrors(errors);
    if (errors.title || errors.course) return;

    // Step 31: Must have a due date picked
    if (!dueAt || dateUnrecognised || !parseTaskDueDate(dueAt)) {
      setDateUnrecognised(true);
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);

    try {
      const parsedWeight = typeof weight === 'number' ? weight : parseFloat(weight);
      const finalWeight = Number.isFinite(parsedWeight) && parsedWeight > 0 ? Math.min(100, parsedWeight) : undefined;

      const uniqueSuffix = typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID().slice(0, 8) 
        : Math.random().toString(36).slice(2, 9);

      const taskToSave: Task = {
        task_id: `task-${Date.now()}-${uniqueSuffix}`,
        title: title.trim(),
        course: course.trim().toUpperCase(),
        type,
        due_at: dueAt,
        status,
        points_earned: pointsEarned.trim(),
        // Store a weight as weight, never as Points Possible
        points_possible: pointsPossible.trim(),
        grade_text: gradeText.trim(),
        feedback: feedback.trim(),
        // Do NOT write the typed sentence into description
        summary: notes.trim(),
        progress_notes: '',
        next_action: '',
        canvas_url: canvasUrl.trim(),
        check_again_at: '',
        source_message_id: '',
        last_email_at: '',
        needs_review: false,
        estimated_hours: typeof estimatedHours === 'number' ? estimatedHours : 3,
        source: 'manual',
        last_interaction_at: toVancouverISO(new Date()),
        ...(finalWeight !== undefined ? { weight: finalWeight } : {})
      } as Task;

      await addTask(taskToSave);
      showToast({ message: 'Saved to Tasks' });
      onClose();
    } catch (err: any) {
      setParseError(taskSaveError(err));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const workloadImpact = checkDateWorkloadImpact(
    tasks, dueAt, type === 'announcement' ? 0 : (typeof estimatedHours === 'number' ? estimatedHours : 3),
    notificationPrefs?.workloadThresholdHours || 15
  );

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={handleBackdropClick}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-task-modal-title"
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg my-auto overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="bg-[#002145] text-white px-5 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-yellow-300">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 id="add-task-modal-title" className="font-bold text-base leading-tight">
                  Add a task
                </h2>
                <p className="text-xs text-blue-200">
                  Type a quick sentence or fill in the details below
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Form */}
          <form id="add-task-form" onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 text-sm">
            {/* Box on top: Describe it in one sentence */}
            <div className="bg-gradient-to-br from-blue-50/70 to-indigo-50/70 border border-blue-200/90 rounded-2xl p-3.5 space-y-2">
              <label htmlFor="quick-add-sentence" className="block text-xs font-bold text-blue-900">
                Describe it in one sentence
              </label>
              <div className="relative">
                <input
                  ref={sentenceInputRef}
                  id="quick-add-sentence"
                  type="text"
                  value={sentenceInput}
                  onChange={(e) => setSentenceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleParseSentence();
                    }
                  }}
                  placeholder='e.g., "CPSC 110 lab 3 due next Friday ~2h worth 10%"'
                  className="w-full bg-white border border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 placeholder-slate-400 transition-all pr-20"
                />
                <button
                  type="button"
                  onClick={() => handleParseSentence()}
                  disabled={isParsing || !sentenceInput.trim()}
                  className="absolute right-1.5 top-1.5 bottom-1.5 bg-[#002145] hover:bg-blue-900 disabled:opacity-40 text-white text-xs font-bold px-3 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {isParsing ? (
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Check size={14} className="text-emerald-400" />
                      <span>Check</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-blue-600/80">
                Press Enter or Check to auto-fill the fields below.
              </p>
            </div>

            {/* Couldn't find due date alert (Step 31 behavior) */}
            {isFallbackActive && (
              <div role="status" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-xs">
                {isDemoMode
                  ? 'This demo uses basic rules, so this is a best guess — check the date and course.'
                  : "We couldn't reach the smart parser, so this is a best guess — check the date and course."}
              </div>
            )}
            {workloadImpact.willOverload && type !== 'announcement' && !['Done', 'Submitted', 'Read'].includes(status) && (
              <div role="status" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-xs">
                <p className="font-bold">Workload crunch warning</p>
                <p>{workloadImpact.weekLabel}: this task brings your workload to {workloadImpact.newTotalHours}h, exceeding your {workloadImpact.threshold}h weekly limit.</p>
              </div>
            )}
            {dateUnrecognised && (
              <div
                id="quick-add-date-unrecognised-alert"
                role="status"
                className="bg-amber-50 border border-amber-300 text-amber-900 text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-2 font-medium animate-in fade-in"
              >
                <AlertCircle size={16} className="text-amber-600 shrink-0" />
                <span>Could not read a due date, please pick one. Missing or past dates need your review.</span>
              </div>
            )}

            {parseError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            <TaskFields identityErrors={identityErrors} prefix="task" requiredDue courseOptions={courseOptions} title={title} course={course} type={type} dueAt={dueAt}
              status={status} summary={notes}
              dueDateError={dateUnrecognised ? 'Enter a valid due date. Check the day and month.' : null}
              onTitleChange={setTitle} onCourseChange={value => setCourse(value.toUpperCase())}
              onTypeChange={value => setType(value as TaskType)} onStatusChange={setStatus} onNotesChange={setNotes}
              onDueChange={value => { setDueAt(value); if (value) setDateUnrecognised(false); }} />

            {/* Detailed only: "More" disclosure holds grade and Canvas-link fields */}
            {!isSimple && (
              <details className="group bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <summary className="px-4 py-2.5 text-xs font-bold text-slate-700 uppercase flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors select-none">
                  <span>More (Grading &amp; Canvas link)</span>
                  <ChevronDown size={16} className="text-slate-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-4 pt-2 border-t border-slate-200 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="task-points-earned" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                        Earned
                      </label>
                      <input
                        id="task-points-earned"
                        type="text"
                        value={pointsEarned}
                        onChange={(e) => setPointsEarned(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs text-emerald-700 font-bold"
                        placeholder="e.g. 48"
                      />
                    </div>
                    <div>
                      <label htmlFor="task-points-possible" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                        Points Possible
                      </label>
                      <input
                        id="task-points-possible"
                        type="text"
                        value={pointsPossible}
                        onChange={(e) => setPointsPossible(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs font-semibold text-slate-700"
                        placeholder="e.g. 50"
                      />
                    </div>
                    <div>
                      <label htmlFor="task-weight" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                        Weight (%)
                      </label>
                      <input
                        id="task-weight"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs font-bold text-blue-800"
                        placeholder="e.g. 10"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="task-grade-text" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                        Letter / Grade
                      </label>
                      <input
                        id="task-grade-text"
                        type="text"
                        value={gradeText}
                        onChange={(e) => setGradeText(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs text-blue-700 font-bold"
                        placeholder="e.g. A+"
                      />
                    </div>
                    <div>
                      <label htmlFor="task-feedback" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                        Feedback
                      </label>
                      <input
                        id="task-feedback"
                        type="text"
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs"
                        placeholder="e.g. Well done"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="task-canvas-url" className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                      Canvas / Submission URL
                    </label>
                    <input
                      id="task-canvas-url"
                      type="url"
                      value={canvasUrl}
                      onChange={(e) => setCanvasUrl(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 text-xs"
                      placeholder="https://canvas.ubc.ca/..."
                    />
                  </div>
                </div>
              </details>
            )}
          </form>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3 rounded-b-2xl shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer text-xs sm:text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-task-form"
              disabled={isSaving || !title.trim() || !course.trim() || !dueAt || dateUnrecognised}
              className="px-4 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors shadow-xs cursor-pointer text-xs sm:text-sm flex items-center gap-1.5"
            >
              {isSaving ? 'Saving...' : 'Save Task'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
