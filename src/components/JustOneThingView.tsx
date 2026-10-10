import { useState, useMemo, useEffect } from 'react';
import { useFocusTimerContext } from '../hooks/useFocusTimer';
import { Task } from '../types';
import { getCourseColor, formatReadableDate, isScheduleEvent, getTaskUrgencyCategory, safeGetTime } from '../utils';
import { pickNextTasks } from '../services/focusService';
import { setUserInitiatedFocus } from './FloatingFocusTimer';
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  ArrowLeft,
  SkipForward,
  Calendar,
  Clock,
  Check
} from 'lucide-react';

interface JustOneThingViewProps {
  onExit: () => void;
}

export default function JustOneThingView({ onExit }: JustOneThingViewProps) {
  const {
    tasks, now,
    updateTask,
    startFocusTimer,
    activeFocus,
    pauseFocusTimer,
    resumeFocusTimer,
    resetFocusTimer,
    stopAndLogFocusTimer
  } = useFocusTimerContext();

  const [skipIndex, setSkipIndex] = useState(0);
  const [completedAnimation, setCompletedAnimation] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completedTask, setCompletedTask] = useState<Task | null>(null);

  // Suppress FloatingFocusTimer while JustOneThingView is mounted (V4-078)
  useEffect(() => {
    document.body.classList.add('just-one-thing-active');
    return () => {
      document.body.classList.remove('just-one-thing-active');
    };
  }, []);

  // Escape key exits
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  // Eligible tasks: prioritized actionable coursework matching Overview queue (V4-080)
  // Excludes non-actionable schedule events (lectures, labs with 0 points) and exams
  const sensibleTasks = useMemo(() => {
    const rawPick = pickNextTasks(tasks);
    const filtered = rawPick.filter(t => !isScheduleEvent(t) && t.type !== 'exam');

    const urgencyWeight: Record<string, number> = {
      today: 1,
      upcoming: 2,
      overdue: 3,
      later: 4,
      nodate: 5
    };

    return [...filtered].sort((a, b) => {
      // Currently 'Working' tasks always first
      if (a.status === 'Working' && b.status !== 'Working') return -1;
      if (b.status === 'Working' && a.status !== 'Working') return 1;

      const urgA = getTaskUrgencyCategory(a, now);
      const urgB = getTaskUrgencyCategory(b, now);

      const weightA = urgencyWeight[urgA] || 99;
      const weightB = urgencyWeight[urgB] || 99;

      if (weightA !== weightB) {
        return weightA - weightB;
      }

      // If both are overdue, prioritize more recent overdue before ancient stale items
      if (urgA === 'overdue' && urgB === 'overdue') {
        const timeA = safeGetTime(a.due_at, 0);
        const timeB = safeGetTime(b.due_at, 0);
        return timeB - timeA;
      }

      const timeA = safeGetTime(a.due_at, Infinity);
      const timeB = safeGetTime(b.due_at, Infinity);
      return timeA - timeB;
    });
  }, [tasks, now]);

  const currentTask: Task | undefined = sensibleTasks[skipIndex % Math.max(1, sensibleTasks.length)];
  // While completedAnimation is active, freeze the card display to the task just completed (V4-079)
  const taskToShow: Task | undefined = (completedAnimation && completedTask) ? completedTask : currentTask;

  // Timer controls: Never start automatically
  const isThisTaskTiming = Boolean(activeFocus && activeFocus.taskId === currentTask?.task_id);
  const isRunning = Boolean(isThisTaskTiming && activeFocus?.isRunning);
  const secondsLeft = isThisTaskTiming && activeFocus ? activeFocus.secondsLeft : 1500;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progressPercent = Math.min(100, Math.max(0, ((1500 - secondsLeft) / 1500) * 100));

  const handleStartTimer = () => {
    if (!currentTask || isCompleting || completedAnimation) return;
    setUserInitiatedFocus(true);
    if (isThisTaskTiming) {
      resumeFocusTimer();
    } else {
      startFocusTimer(
        {
          id: currentTask.task_id,
          title: currentTask.title,
          course: currentTask.course
        },
        25,
        'pomodoro'
      );
    }
  };

  const handlePauseTimer = () => {
    if (isCompleting || completedAnimation) return;
    pauseFocusTimer();
  };

  const handleResetTimer = () => {
    if (isCompleting || completedAnimation) return;
    if (isThisTaskTiming) {
      resetFocusTimer();
    }
  };

  const handleCompleteTask = async () => {
    if (!currentTask || isCompleting || completedAnimation) return;
    const taskToComplete = currentTask;
    setIsCompleting(true);
    setCompletedAnimation(true);
    setCompletedTask(taskToComplete);
    try {
      if (isThisTaskTiming) {
        stopAndLogFocusTimer();
        setUserInitiatedFocus(false);
      }
      await updateTask(taskToComplete.task_id, { status: 'Done' });
    } finally {
      setTimeout(() => {
        setCompletedAnimation(false);
        setIsCompleting(false);
        setCompletedTask(null);
        setSkipIndex(0);
      }, 500);
    }
  };

  const handleSkipNext = () => {
    if (isCompleting || completedAnimation) return;
    setSkipIndex(prev => prev + 1);
  };

  if (sensibleTasks.length === 0) {
    return (
      <div id="just-one-thing-view" className="max-w-xl mx-auto py-8">
        <style>{'#floating-focus-timer-host { display: none !important; }'}</style>
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={36} />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Focus on one task</h1>
          <p className="text-sm text-slate-500 mb-6">
            {tasks.length === 0
              ? 'Nothing here yet. Upload a course outline to add deadlines, or add a task by hand.'
              : 'Nothing pending.'}
          </p>
          <button
            type="button"
            autoFocus
            tabIndex={1}
            onClick={onExit}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Exit Focus on one task</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="just-one-thing-view" className="max-w-2xl mx-auto py-4 sm:py-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
      <style>{'#floating-focus-timer-host { display: none !important; }'}</style>
      {/* Top Bar: Back is the first item in the tab order */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          autoFocus
          tabIndex={1}
          onClick={onExit}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-4 py-2.5 rounded-xl transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft size={16} />
          <span>Exit Focus on one task</span>
        </button>

        <span className="text-xs font-semibold text-slate-400">
          Task { (skipIndex % sensibleTasks.length) + 1 } of { sensibleTasks.length }
        </span>
      </div>

      {/* Main Card */}
      <div className={`bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-10 transition-all ${
        completedAnimation ? 'scale-95 opacity-50' : ''
      }`}>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight text-center mb-6">
          Focus on one task
        </h1>

        {/* Task Showcase Card */}
        {taskToShow && (
          <div className="bg-gradient-to-b from-slate-50 to-indigo-50/20 border border-slate-200/80 rounded-2xl p-6 mb-8 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${getCourseColor(taskToShow.course)}`}>
                {taskToShow.course}
              </span>
              {taskToShow.type && (
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                  {taskToShow.type}
                </span>
              )}
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {taskToShow.title}
            </h2>

            <div className="flex items-center justify-center gap-4 text-xs font-semibold text-slate-500 flex-wrap pt-1">
              {taskToShow.due_at && (
                <span className="flex items-center gap-1 text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100">
                  <Calendar size={13} />
                  <span>Due {formatReadableDate(taskToShow.due_at)}</span>
                </span>
              )}
              {taskToShow.estimated_hours && (
                <span className="flex items-center gap-1 text-slate-600">
                  <Clock size={13} />
                  <span>{taskToShow.estimated_hours}h estimated</span>
                </span>
              )}
            </div>

            {taskToShow.summary && (
              <p className="text-xs text-slate-600 max-w-md mx-auto pt-2 leading-relaxed">
                {taskToShow.summary}
              </p>
            )}

            {/* Subtasks if present */}
            {taskToShow.subtasks && taskToShow.subtasks.length > 0 && (
              <div className="pt-3 max-w-sm mx-auto text-left border-t border-slate-200/60 space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Next sub-steps:
                </span>
                {taskToShow.subtasks.slice(0, 3).map(st => (
                  <div key={st.id} className="text-xs text-slate-700 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                    <span className={st.done ? 'line-through text-slate-400' : 'font-medium'}>{st.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Big 25-Minute Pomodoro Timer */}
        <div className="flex flex-col items-center justify-center my-6">
          <div className="font-mono text-6xl sm:text-7xl font-black tracking-tight text-slate-900 drop-shadow-xs">
            {formattedTime}
          </div>

          <div className="w-full max-w-xs bg-slate-100 h-2.5 rounded-full mt-4 overflow-hidden border border-slate-200">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Timer Controls */}
          <div className="flex items-center gap-3 mt-6">
            {isRunning ? (
              <button
                type="button"
                onClick={handlePauseTimer}
                disabled={isCompleting || completedAnimation}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-sm px-6 py-3 rounded-2xl shadow-sm transition-all cursor-pointer"
              >
                <Pause size={18} />
                <span>Pause timer</span>
              </button>
            ) : isThisTaskTiming && secondsLeft < 1500 ? (
              <button
                type="button"
                onClick={handleStartTimer}
                disabled={isCompleting || completedAnimation}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm px-6 py-3 rounded-2xl shadow-md transition-all cursor-pointer"
              >
                <Play size={18} />
                <span>Resume timer</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartTimer}
                disabled={isCompleting || completedAnimation}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-sm px-8 py-3 rounded-2xl shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                <Play size={18} />
                <span>Start 25-minute timer</span>
              </button>
            )}

            {isThisTaskTiming && (
              <button
                type="button"
                onClick={handleResetTimer}
                disabled={isCompleting || completedAnimation}
                className="p-3 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50 rounded-2xl transition-colors cursor-pointer"
                title="Reset timer to 25m"
              >
                <RotateCcw size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Bottom Actions: Show another vs Done */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-slate-100 mt-6">
          <button
            type="button"
            onClick={handleSkipNext}
            disabled={isCompleting || completedAnimation}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer border border-slate-200"
          >
            <SkipForward size={14} />
            <span>Show another</span>
          </button>

          <button
            type="button"
            onClick={handleCompleteTask}
            disabled={isCompleting || completedAnimation}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Check size={16} />
            <span>{isCompleting || completedAnimation ? 'Completing...' : 'Done'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
