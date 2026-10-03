import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Task, SubTask } from '../types';
import { useTasksContext } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { auth } from '../auth';
import { formatReadableDate, toVancouverDateString, parseTaskDueDate } from '../utils';
import { addDaysToDateStr, getTaskEstimatedHours } from '../services/workloadService';
import { 
  X, 
  Sparkles, 
  CheckCircle2, 
  Circle, 
  Calendar, 
  Clock, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ListTree,
  Info
} from 'lucide-react';

interface TaskBreakdownModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
}

export default function TaskBreakdownModal({ task, isOpen, onClose }: TaskBreakdownModalProps) {
  const { updateTask, isDemoMode } = useTasksContext();
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  const [subtasks, setSubtasks] = useState<SubTask[]>(task.subtasks || []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [planSource, setPlanSource] = useState<'ai' | 'fallback' | null>(null);
  const [showConfirmReplace, setShowConfirmReplace] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [newStepDuration, setNewStepDuration] = useState('1 hour');

  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync subtasks when task changes or modal opens
  useEffect(() => {
    setSubtasks(task.subtasks || []);
    setError(null);
    setFallbackUsed(false);
    setFallbackMessage(null);
    setPlanSource(null);
    setShowConfirmReplace(false);
  }, [task.task_id, isOpen]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);


  const rawDueDate = task.due_at ? toVancouverDateString(task.due_at) : '';
  const todayFormatted = toVancouverDateString(new Date());
  const isOverdue = Boolean(rawDueDate && rawDueDate < todayFormatted);

  const completedCount = subtasks.filter(st => st.done).length;
  const totalCount = subtasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const totalPlannedHours = useMemo(() => {
    let total = 0;
    for (const st of subtasks) {
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
  }, [subtasks]);

  const generateClientFallbackSteps = (t: Task): SubTask[] => {
    const cleanTitle = (t.title || 'Assignment').toLowerCase();
    const cleanType = (t.type || 'assignment').toLowerCase();
    const today = toVancouverDateString(new Date());
    const rawDue = t.due_at ? toVancouverDateString(t.due_at) : '';
    const taskOverdue = Boolean(rawDue && rawDue < today);

    let steps = [
      { title: `Review guidelines and requirements for ${t.title}`, duration: '45 mins' },
      { title: 'Draft initial work / problem set solutions', duration: '2 hours' },
      { title: 'Complete remaining components & calculations', duration: '2 hours' },
      { title: 'Verify against grading rubric & check edge cases', duration: '1 hour' },
      { title: 'Final proofread, formatting, and submission', duration: '30 mins' }
    ];

    if (cleanType === 'quiz') {
      steps = [
        { title: 'Review the topics covered by this quiz', duration: '30 mins' },
        { title: 'Practice a few relevant questions', duration: '45 mins' },
        { title: 'Check answers and review any mistakes', duration: '15 mins' }
      ];
    } else if (cleanType === 'exam' || cleanTitle.includes('exam') || cleanTitle.includes('midterm')) {
      steps = [
        { title: `Review lecture notes & slide decks for ${t.course || 'course'}`, duration: '1.5 hours' },
        { title: 'Create summary cheat sheet & formula notes', duration: '1 hour' },
        { title: 'Work through past exams and sample questions', duration: '2.5 hours' },
        { title: 'Review weak topics and target tricky problem sets', duration: '1.5 hours' },
        { title: 'Final rapid review and formula recall check', duration: '45 mins' }
      ];
    } else if (cleanType === 'project' || cleanTitle.includes('project') || cleanTitle.includes('milestone')) {
      steps = [
        { title: 'Review project requirements & design architecture', duration: '1 hour' },
        { title: 'Scaffold project code & setup test environment', duration: '1.5 hours' },
        { title: 'Implement core application features & business logic', duration: '3 hours' },
        { title: 'Run tests, resolve bugs & polish interface', duration: '2 hours' },
        { title: 'Package submission, verify documentation & submit', duration: '45 mins' }
      ];
    }

    // Allocate the task's estimated effort across the template's relative weights.
    const estimated = Number(t.estimated_hours);
    const totalMinutes = Math.max(1, Math.round((Number.isFinite(estimated) && estimated > 0
      ? estimated : getTaskEstimatedHours(t)) * 60));
    const weights = steps.map(s => parseFloat(s.duration) * (s.duration.includes('hour') ? 60 : 1));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    let allocated = 0;
    steps = steps.map((s, index) => {
      const end = Math.round(weights.slice(0, index + 1).reduce((sum, weight) => sum + weight, 0) / weightTotal * totalMinutes);
      const minutes = end - allocated;
      allocated = end;
      return { ...s, duration: `${minutes} mins` };
    });

    // V4-140 Fix: Never back-plan past a passed deadline
    if (taskOverdue) {
      return steps.map((s, idx) => ({
        id: `st-${Date.now()}-${idx + 1}`,
        title: s.title,
        done: false,
        startDate: rawDue,
        doByDate: rawDue,
        duration: s.duration,
        notes: ''
      }));
    }

    // Future or today deadline: space out dates backward from rawDue to today
    const targetDueDate = rawDue || today;
    const todayDate = new Date(`${today}T00:00:00Z`);
    const dueDate = new Date(`${targetDueDate}T00:00:00Z`);
    const diffDays = Math.max(0, Math.round((dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)));

    return steps.map((s, idx) => {
      const stepFraction = idx / steps.length;
      const endFraction = (idx + 1) / steps.length;
      
      const startOffset = Math.min(diffDays, Math.floor(stepFraction * diffDays));
      const doByOffset = Math.min(diffDays, Math.max(startOffset, Math.floor(endFraction * diffDays)));

      const startStr = addDaysToDateStr(today, startOffset);
      let doByStr = addDaysToDateStr(today, doByOffset);

      // Clamp so it never exceeds the deadline
      if (rawDue && doByStr > rawDue) doByStr = rawDue;
      if (startStr > doByStr) doByStr = startStr;

      return {
        id: `st-${Date.now()}-${idx + 1}`,
        title: s.title,
        done: false,
        startDate: startStr,
        doByDate: doByStr,
        duration: s.duration,
        notes: ''
      };
    });
  };

  const handleGenerateClick = () => {
    // V4-140 Fix: Confirm before replacing an existing plan
    if (subtasks.length > 0) {
      setShowConfirmReplace(true);
    } else {
      executeGenerateSteps();
    }
  };

  const executeGenerateSteps = async () => {
    setIsGenerating(true);
    setError(null);
    setShowConfirmReplace(false);

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let token = '';
      if (auth.currentUser) {
        try {
          token = await auth.currentUser.getIdToken();
        } catch {
          // Token retrieval failed
        }
      }

      if (!token && isDemoMode) {
        const fallback = generateClientFallbackSteps(task);
        setSubtasks(fallback);
        setFallbackUsed(true);
        setPlanSource('fallback');
        setFallbackMessage("These steps use a template, not AI. Durations match your estimated effort; adjust the steps and dates as needed.");
        return;
      }

      const response = await fetch('/api/ai/breakdown-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        signal: abortController.signal,
        body: JSON.stringify({
          taskId: task.task_id,
          title: task.title,
          course: task.course,
          type: task.type,
          dueAt: task.due_at,
          summary: task.summary
        })
      });

      if (!response.ok) {
        const fallback = generateClientFallbackSteps(task);
        setSubtasks(fallback);
        setFallbackUsed(true);
        setPlanSource('fallback');
        setFallbackMessage("These steps use a template, not AI. Durations match your estimated effort; adjust the steps and dates as needed.");
        return;
      }

      const data = await response.json();
      // Track source like EditTaskModal does: data.source === 'gemini_ai'
      const isAI = data.source === 'gemini_ai';
      if (isAI && Array.isArray(data.subtasks) && data.subtasks.length > 0) {
        setSubtasks(data.subtasks);
        setFallbackUsed(false);
        setPlanSource('ai');
        setFallbackMessage(null);
      } else {
        const steps = generateClientFallbackSteps(task);
        setSubtasks(steps);
        setFallbackUsed(true);
        setPlanSource('fallback');
        setFallbackMessage("These steps use a template, not AI. Durations match your estimated effort; adjust the steps and dates as needed.");
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('Breakdown generation falling back to local planner:', err);
      const fallback = generateClientFallbackSteps(task);
      setSubtasks(fallback);
      setFallbackUsed(true);
      setPlanSource('fallback');
      setFallbackMessage("These steps use a template, not AI. Durations match your estimated effort; adjust the steps and dates as needed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks(prev => prev.map(st => st.id === id ? { ...st, done: !st.done } : st));
  };

  const handleUpdateSubtaskField = (id: string, field: keyof SubTask, value: any) => {
    setSubtasks(prev => prev.map(st => st.id === id ? { ...st, [field]: value } : st));
  };

  const handleDeleteSubtask = (id: string) => {
    setSubtasks(prev => prev.filter(st => st.id !== id));
  };

  const handleAddCustomStep = () => {
    if (!newStepTitle.trim()) return;
    const today = toVancouverDateString(new Date());
    const rawDue = task.due_at ? toVancouverDateString(task.due_at) : '';
    const taskOverdue = Boolean(rawDue && rawDue < today);

    // V4-140 Fix: Custom steps do not plan past a passed deadline, and future steps start today
    const defaultStart = taskOverdue ? rawDue : today;
    const defaultDoBy = rawDue;

    const newStep: SubTask = {
      id: `st-${Date.now()}-${subtasks.length + 1}`,
      title: newStepTitle.trim(),
      done: false,
      startDate: defaultStart,
      doByDate: defaultDoBy,
      duration: newStepDuration.trim() || '1 hour'
    };
    setSubtasks(prev => [...prev, newStep]);
    setNewStepTitle('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Determine if parent task status should update automatically
      let updatedStatus = task.status;
      if (subtasks.length > 0) {
        const allDone = subtasks.every(st => st.done);
        const anyDone = subtasks.some(st => st.done);
        if (allDone) {
          // If all subtasks are complete, mark task Done
          updatedStatus = 'Done';
        } else if (anyDone) {
          // If some subtasks are completed and task was Not Started, advance to Working
          if (task.status === 'Not Started') {
            updatedStatus = 'Working';
          }
        } else if (!anyDone && task.status === 'Done') {
          // If all subtasks were unchecked on a Done task, revert to Working
          updatedStatus = 'Working';
        }
      }

      await updateTask(task.task_id, {
        subtasks,
        status: updatedStatus,
        last_interaction_at: new Date().toISOString()
      });
      onClose();
    } catch (err) {
      console.error('Failed to save subtasks:', err);
      setError("We couldn't save your steps. We'll keep trying — you can keep working.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="breakdown-modal-title"
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-start bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800">
                {task.course}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {task.type ? task.type.toUpperCase() : 'ASSIGNMENT'}
              </span>
              {task.due_at && (
                <span className={`text-xs font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md ${
                  isOverdue ? 'bg-red-100 text-red-700' : 'bg-slate-200/70 text-slate-600'
                }`}>
                  <Calendar size={11} /> {isOverdue ? 'Overdue: ' : 'Due '} {formatReadableDate(task.due_at)}
                </span>
              )}
            </div>
            <h2 id="breakdown-modal-title" className="text-lg font-bold text-slate-900">
              Plan steps for this {task.type || 'assignment'}
            </h2>
            <p className="text-xs text-slate-500">
              {task.title}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 text-sm">
          
          {/* Action Hero / Generator Banner */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-indigo-900 font-bold text-sm">
                <Sparkles size={16} className="text-indigo-600" />
                <span>
                  {fallbackUsed ? 'Suggested template' : 'Plan the steps backward from the due date'}
                </span>
                {planSource === 'ai' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                    AI Plan
                  </span>
                )}
                {fallbackUsed && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md">
                    Suggested template
                  </span>
                )}
              </div>
              <p className="text-xs text-indigo-700/90 max-w-md">
                {fallbackUsed 
                  ? "These steps use a template, not AI. Durations match your estimated effort; adjust the steps and dates as needed." 
                  : <>Automatically work backward from <strong>{task.due_at ? formatReadableDate(task.due_at) : 'your deadline'}</strong> to suggest start dates, do-by milestones, and realistic duration buffers.</>
                }
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerateClick}
              disabled={isGenerating}
              className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Planning steps...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>
                    Plan the steps
                  </span>
                </>
              )}
            </button>
          </div>

          {/* V4-140 Confirmation Banner when re-planning over existing steps */}
          {showConfirmReplace && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2.5 text-xs animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-900 text-sm">
                    Replace existing study plan?
                  </p>
                  <p className="text-amber-800">
                    This task already has {subtasks.length} step{subtasks.length === 1 ? '' : 's'} ({completedCount} completed). Re-planning will overwrite these steps and reset completion progress.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 pl-7">
                <button
                  type="button"
                  onClick={executeGenerateSteps}
                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg cursor-pointer transition-colors shadow-xs"
                >
                  Yes, Re-plan Steps
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmReplace(false)}
                  className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold border border-slate-300 rounded-lg cursor-pointer transition-colors"
                >
                  Keep Current Steps
                </button>
              </div>
            </div>
          )}

          {/* Fallback Inline Notice */}
          {fallbackUsed && (
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
              <Info size={15} className="shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <span>{fallbackMessage || "These steps use a template, not AI. Durations match your estimated effort; adjust the steps and dates as needed."}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Progress Indicator */}
          {totalCount > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-700">
                    Steps: {completedCount} of {totalCount} completed
                  </span>
                  {totalPlannedHours > 0 && (
                    <span className="text-slate-500 font-medium flex items-center gap-1">
                      <Clock size={12} className="text-slate-400" /> {totalPlannedHours} hrs total
                    </span>
                  )}
                </div>
                <span className="font-extrabold text-blue-600">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Subtasks List */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <ListTree size={14} className="text-slate-400" />
                <span>Steps ({subtasks.length})</span>
              </h3>
            </div>

            {subtasks.length === 0 ? (
              <div className="text-center py-10 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 mx-auto flex items-center justify-center">
                  <Sparkles size={20} />
                </div>
                <div>
                  <p className="font-bold text-slate-800 text-sm">No steps planned yet</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                    Click <strong>"Plan the steps"</strong> above to generate a backward-planned schedule or add your own custom steps below.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {subtasks.map((step, index) => {
                  const startDate = parseTaskDueDate(step.startDate);
                  const doByDate = parseTaskDueDate(step.doByDate);
                  const startValue = startDate ? toVancouverDateString(startDate) : '';
                  const doByValue = doByDate ? toVancouverDateString(doByDate) : '';
                  const hasDateInversion = Boolean(startValue && doByValue && startValue > doByValue);
                  const exceedsTaskDue = Boolean(rawDueDate && doByValue && doByValue > rawDueDate);

                  return (
                    <div
                      key={step.id || index}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 ${
                        step.done 
                          ? 'bg-slate-50/70 border-slate-200 opacity-80' 
                          : 'bg-white border-slate-200 shadow-2xs hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={() => handleToggleSubtask(step.id)}
                          className="mt-0.5 text-slate-400 hover:text-blue-600 shrink-0 cursor-pointer transition-colors"
                          aria-label={step.done ? `Mark step "${step.title}" as incomplete` : `Mark step "${step.title}" as complete`}
                        >
                          {step.done ? (
                            <CheckCircle2 size={19} className="text-emerald-600 fill-emerald-50" />
                          ) : (
                            <Circle size={19} className="text-slate-400 hover:text-blue-500" />
                          )}
                        </button>

                        {/* Title & Inputs */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            type="text"
                            value={step.title}
                            aria-label={`Step ${index + 1} description`}
                            onChange={(e) => handleUpdateSubtaskField(step.id, 'title', e.target.value)}
                            placeholder="Step description..."
                            className={`w-full text-xs font-semibold text-slate-800 bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none px-0 py-0.5 transition-colors ${
                              step.done ? 'line-through text-slate-500' : ''
                            }`}
                          />

                          {/* Date and Duration Controls */}
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                            <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200/80">
                              <Calendar size={12} className="text-slate-400 shrink-0" />
                              <span className="font-medium text-slate-500">Start:</span>
                              <input
                                type="date"
                                aria-label={`Step ${index + 1} start date`}
                                value={startValue}
                                onChange={(e) => handleUpdateSubtaskField(step.id, 'startDate', e.target.value)}
                                className="bg-transparent border-0 outline-none text-slate-800 font-semibold p-0 text-[11px] cursor-pointer"
                              />
                            </div>

                            <ArrowRight size={11} className="text-slate-400 shrink-0" />

                            <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200/80">
                              <Calendar size={12} className="text-blue-500 shrink-0" />
                              <span className="font-medium text-slate-500">Do by:</span>
                              <input
                                type="date"
                                aria-label={`Step ${index + 1} do by date`}
                                value={doByValue}
                                onChange={(e) => handleUpdateSubtaskField(step.id, 'doByDate', e.target.value)}
                                className="bg-transparent border-0 outline-none text-blue-700 font-semibold p-0 text-[11px] cursor-pointer"
                              />
                            </div>

                            <div className="flex items-center gap-1 bg-amber-50 text-amber-800 px-2 py-1 rounded-lg border border-amber-200/60 ml-auto">
                              <Clock size={11} className="text-amber-600 shrink-0" />
                              <input
                                type="text"
                                aria-label={`Step ${index + 1} duration`}
                                value={step.duration || ''}
                                onChange={(e) => handleUpdateSubtaskField(step.id, 'duration', e.target.value)}
                                placeholder="e.g. 1.5 hrs"
                                className="bg-transparent border-0 outline-none text-amber-900 font-bold p-0 text-[11px] w-16"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDeleteSubtask(step.id)}
                              aria-label={`Delete step ${step.title || index + 1}`}
                              className="text-slate-300 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition-colors cursor-pointer ml-1"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Date Warnings */}
                          {hasDateInversion && (
                            <p className="text-[10px] text-red-600 font-medium flex items-center gap-1 pt-0.5">
                              <AlertCircle size={11} /> Start date is after the target do-by date.
                            </p>
                          )}
                          {!hasDateInversion && exceedsTaskDue && (
                            <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1 pt-0.5">
                              <AlertTriangle size={11} /> Do-by date is scheduled after the task deadline.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Custom Step Form */}
            <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
              <input
                type="text"
                value={newStepTitle}
                aria-label="New custom step title"
                onChange={(e) => setNewStepTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomStep();
                  }
                }}
                placeholder="+ Add a custom step..."
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors"
              />
              <input
                type="text"
                value={newStepDuration}
                aria-label="New custom step duration"
                onChange={(e) => setNewStepDuration(e.target.value)}
                placeholder="Duration (e.g. 1 hr)"
                className="w-24 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors"
              />
              <button
                type="button"
                onClick={handleAddCustomStep}
                disabled={!newStepTitle.trim()}
                className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1 transition-colors cursor-pointer border border-slate-200"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {subtasks.length > 0 && `${completedCount} of ${totalCount} steps marked complete`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors shadow-sm cursor-pointer text-xs flex items-center gap-1.5"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              <span>Save steps</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
