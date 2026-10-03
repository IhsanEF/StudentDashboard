import { useState, useEffect, useRef } from 'react';
import { useFocusTimerContext } from '../hooks/useFocusTimer';
import { useModalFocus } from '../hooks/useModalFocus';
import { getCourseColor } from '../utils';
import { FocusTimerMode } from '../types';
import { auth } from '../auth';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  Minimize2, 
  Maximize2, 
  X, 
  Flame, 
  Clock, 
  Brain,
  ChevronDown
} from 'lucide-react';

let userInitiatedFocus = false;

/**
 * Returns the user-scoped localStorage key for active focus timer persistence (V4-284)
 */
export function getScopedFocusTimerKey(userId?: string | null): string {
  const uid = userId || auth.currentUser?.uid || 'demo-student';
  return `ubc_active_focus_timer_${uid}`;
}

/**
 * Clears focus timer persistence caches across localStorage and sessionStorage (V4-284)
 */
export function clearFocusTimerStorage(userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const uid = userId || auth.currentUser?.uid || 'demo-student';
    localStorage.removeItem(`ubc_active_focus_timer_${uid}`);
    localStorage.removeItem('ubc_active_focus_timer');
    localStorage.removeItem('ubc_active_focus_timer_demo-student');
    localStorage.removeItem('ubc_active_focus_timer_demo_student');
    sessionStorage.removeItem('ubc_focus_timer_user_action');
    sessionStorage.removeItem('ubc_focus_timer_task_id');
    sessionStorage.removeItem('ubc_focus_timer_user_id');
  } catch (err) {
    console.warn('Error clearing focus timer storage:', err);
  }
}

export function setUserInitiatedFocus(val: boolean, taskId?: string | null, userId?: string | null) {
  userInitiatedFocus = val;
  if (typeof window !== 'undefined') {
    if (val) {
      sessionStorage.setItem('ubc_focus_timer_user_action', 'true');
      if (taskId) sessionStorage.setItem('ubc_focus_timer_task_id', taskId);
      const uid = userId || auth.currentUser?.uid || (sessionStorage.getItem('ubc_demo_mode') === 'true' ? 'demo-student' : 'guest');
      sessionStorage.setItem('ubc_focus_timer_user_id', uid);
    } else {
      sessionStorage.removeItem('ubc_focus_timer_user_action');
      sessionStorage.removeItem('ubc_focus_timer_task_id');
      sessionStorage.removeItem('ubc_focus_timer_user_id');
    }
  }
}

export function isFocusUserInitiated(
  currentTaskId?: string | null, 
  isDemo?: boolean,
  currentUserId?: string | null,
  timerUserId?: string | null
): boolean {
  if (timerUserId && currentUserId && timerUserId !== currentUserId) {
    return false;
  }
  if (userInitiatedFocus) return true;
  // In demo mode or if user has not explicitly started focus in this session, do not auto-mount (V4-271, V4-276)
  if (isDemo) return false;
  if (typeof window !== 'undefined') {
    const isStored = sessionStorage.getItem('ubc_focus_timer_user_action') === 'true';
    if (!isStored) return false;
    const storedTaskId = sessionStorage.getItem('ubc_focus_timer_task_id');
    if (currentTaskId && storedTaskId && storedTaskId !== currentTaskId) {
      return false;
    }
    const storedUserId = sessionStorage.getItem('ubc_focus_timer_user_id');
    if (currentUserId && storedUserId && storedUserId !== currentUserId) {
      return false;
    }
    return isStored;
  }
  return false;
}

export default function FloatingFocusTimer() {
  const { 
    activeFocus, 
    pauseFocusTimer, 
    resumeFocusTimer, 
    resetFocusTimer, 
    stopAndLogFocusTimer,
    startFocusTimer,
    tasks,
    isDemoMode
  } = useFocusTimerContext();

  const currentUserId = isDemoMode ? 'demo_student' : (auth.currentUser?.uid || 'guest');

  // Default to minimized pill on mobile & small desktop screens (<= 1024px)
  // to prevent overlapping the primary task list or Focus Next cards (V4-210, V4-271)
  const [isMinimized, setIsMinimized] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 1024;
    }
    return false;
  });

  const [isDismissed, setIsDismissed] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [customMinutesToLog, setCustomMinutesToLog] = useState<number>(1);
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  useEffect(() => {
    setIsDismissed(false);
    setShowLogModal(false);
  }, [activeFocus?.sessionId]);

  // Focus management references (V4-223)
  const pillRef = useRef<HTMLButtonElement>(null);
  const minimizeBtnRef = useRef<HTMLButtonElement>(null);
  const wasExpandedRef = useRef<boolean>(false);

  // Modal focus trap & ESC handling for Log modal (V4-223)
  const { modalRef: logModalRef, handleBackdropClick: handleLogModalBackdrop } = useModalFocus({
    isOpen: showLogModal,
    onClose: () => setShowLogModal(false)
  });

  // Clean un-scoped legacy key on mount and listen to sign-out (V4-284)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('ubc_active_focus_timer');
      } catch {
        // ignore
      }
    }
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user && !isDemoMode) {
        setUserInitiatedFocus(false);
        clearFocusTimerStorage();
      }
    });
    return () => unsubscribe();
  }, [isDemoMode]);

  // Detect anti-stress / JustOneThingView in DOM to hide floating timer while active (V4-210, V4-276)
  const [inAntiStressView, setInAntiStressView] = useState(() => {
    if (typeof document === 'undefined') return false;
    return Array.from(document.querySelectorAll('h1')).some(h => h.textContent?.includes('One task')) ||
      Boolean(document.querySelector('#just-one-thing-view'));
  });

  useEffect(() => {
    const checkAntiStress = () => {
      if (typeof document === 'undefined') return;
      const isZen = Array.from(document.querySelectorAll('h1')).some(h => h.textContent?.includes('One task')) ||
        Boolean(document.querySelector('#just-one-thing-view'));
      setInAntiStressView(isZen);
    };

    checkAntiStress();
    const observer = new MutationObserver(checkAntiStress);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // When expanding or minimizing, manage keyboard focus cleanly so focus does not drop to <body> (V4-223)
  useEffect(() => {
    if (isMinimized) {
      if (wasExpandedRef.current && pillRef.current) {
        pillRef.current.focus();
      }
    } else {
      if (wasExpandedRef.current && minimizeBtnRef.current) {
        setTimeout(() => {
          minimizeBtnRef.current?.focus();
        }, 50);
      }
    }
  }, [isMinimized]);

  // Add matching bottom padding to scroll area while activeFocus is expanded on desktop/mobile (V4-210, V4-271)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const mainEl = document.querySelector('main');
    if (activeFocus && !isMinimized && !inAntiStressView && !isDismissed) {
      mainEl?.classList.add('pb-72');
      mainEl?.classList.add('lg:pb-80');
      return () => {
        mainEl?.classList.remove('pb-72');
        mainEl?.classList.remove('lg:pb-80');
      };
    }
  }, [activeFocus, isMinimized, inAntiStressView, isDismissed]);

  // If dismissed by user close (X), return null (V4-276)
  if (isDismissed) return null;

  // If anti-stress view is active, hide the floating timer completely (V4-210, V4-276)
  const isAntiStressActiveNow = inAntiStressView || (typeof document !== 'undefined' && Array.from(document.querySelectorAll('h1')).some(h => h.textContent?.includes('One task')));
  if (isAntiStressActiveNow) return null;

  // Only mount when user explicitly initiated session (V4-264, V4-271, V4-276)
  if (!activeFocus || !isFocusUserInitiated(activeFocus.taskId, isDemoMode, currentUserId, activeFocus.userId)) return null;

  // Guard against cross-account timer display: only show if owned by current user (V4-284)
  if (activeFocus.userId && activeFocus.userId !== currentUserId) {
    return null;
  }

  const totalSecs = activeFocus.durationSeconds || 1500;
  const currentSecs = activeFocus.secondsLeft;
  const remainingSecs = activeFocus.isRunning && activeFocus.endsAt
    ? Math.max(0, (activeFocus.endsAt - Date.now()) / 1000)
    : currentSecs;
  const elapsedSecs = Math.max(0, totalSecs - remainingSecs);
  const loggedSecs = activeFocus.loggedSeconds || 0;
  const unloggedSecs = Math.max(0, elapsedSecs - loggedSecs);
  const unloggedMinutes = unloggedSecs < 30 ? 0 : Math.min(480, Math.round(unloggedSecs / 60));

  const minutes = Math.floor(currentSecs / 60);
  const seconds = currentSecs % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  const progressPercent = Math.min(100, Math.max(0, ((totalSecs - currentSecs) / totalSecs) * 100));

  // Find associated task if any
  const associatedTask = activeFocus.taskId ? tasks.find(t => t.task_id === activeFocus.taskId) : null;
  const loggedMinutes = associatedTask?.logged_minutes || 0;
  const estimatedHours = associatedTask?.estimated_hours || 0;

  const handleOpenLogModal = () => {
    setCustomMinutesToLog(Math.max(1, unloggedMinutes));
    setShowLogModal(true);
  };

  const handleClose = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsDismissed(true);
    setUserInitiatedFocus(false);
    clearFocusTimerStorage(currentUserId);
    try {
      await stopAndLogFocusTimer(0);
    } catch {
      // ignore
    }
  };

  const handleConfirmLog = async () => {
    if (isLogging) return;
    // Guard: Only log completed intervals to the account that started them (V4-284)
    if (activeFocus.userId && activeFocus.userId !== currentUserId) {
      handleClose();
      return;
    }
    setIsLogging(true);
    setIsDismissed(true);
    setUserInitiatedFocus(false);
    setShowLogModal(false);
    try {
      const minutesToLog = unloggedMinutes === 0 ? 0 : Math.min(480, Math.max(1,
        Number.isFinite(customMinutesToLog) ? Math.round(customMinutesToLog) : 1));
      await stopAndLogFocusTimer(minutesToLog);
    } finally {
      setIsLogging(false);
    }
  };

  const handleQuickPreset = (presetMinutes: number, mode: FocusTimerMode) => {
    setUserInitiatedFocus(true, activeFocus.taskId, currentUserId);
    startFocusTimer(
      {
        id: activeFocus.taskId || '',
        title: activeFocus.taskTitle,
        course: activeFocus.courseCode
      },
      presetMinutes,
      mode
    );
  };

  const handleMinimize = () => {
    wasExpandedRef.current = true;
    setIsMinimized(true);
  };

  const handleExpand = () => {
    wasExpandedRef.current = true;
    setIsMinimized(false);
  };

  // Minimized floating pill as accessible <button> (V4-223)
  if (isMinimized) {
    return (
      <aside 
        aria-label="Active focus timer"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 right-4 z-50 flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-3"
      >
        <button 
          ref={pillRef}
          type="button" 
          onClick={handleExpand}
          title="Expand timer"
          aria-label="Expand timer"
          className="bg-[#002145] text-white shadow-xl rounded-full px-4 py-2 flex items-center gap-3 border border-blue-400/30 cursor-pointer hover:bg-[#002f63] focus:outline-hidden focus:ring-2 focus:ring-blue-400 transition-all text-left"
        >
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex items-center gap-2 font-mono font-bold text-sm">
            <span>{formattedTime}</span>
            <span className="text-xs text-blue-200 truncate max-w-[120px] font-sans">
              {activeFocus.courseCode ? `[${activeFocus.courseCode}] ` : ''}{activeFocus.taskTitle}
            </span>
          </div>
          <span className="text-blue-300 p-0.5" aria-hidden="true">
            <Maximize2 size={14} />
          </span>
        </button>
        <button 
          type="button" 
          onClick={handleClose}
          className="bg-[#002145] text-blue-300 hover:text-rose-400 p-2 rounded-full border border-blue-400/30 shadow-lg hover:bg-[#002f63] focus:outline-hidden focus:ring-2 focus:ring-rose-400 transition-colors cursor-pointer"
          title="Close"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside 
        aria-label="Active focus timer"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 right-4 z-50 w-80 sm:w-88 bg-slate-900/95 backdrop-blur-md text-white shadow-2xl rounded-2xl border border-slate-700/60 p-4 animate-in fade-in slide-in-from-bottom-4 transition-all"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-md bg-blue-500/20 text-blue-400">
              <Brain size={15} />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              {activeFocus.mode === 'short_break' ? 'Short Break' : activeFocus.mode === 'long_break' ? 'Long Break' : 'Focus Session'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              ref={minimizeBtnRef}
              type="button"
              onClick={handleMinimize}
              className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              title="Minimize timer"
              aria-label="Minimize timer"
            >
              <Minimize2 size={14} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-1 text-slate-400 hover:text-rose-400 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Task info */}
        <div className="mt-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeFocus.courseCode && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${getCourseColor(activeFocus.courseCode)}`}>
                {activeFocus.courseCode}
              </span>
            )}
            <h4 className="text-sm font-semibold text-white truncate max-w-[200px]" title={activeFocus.taskTitle}>
              {activeFocus.taskTitle}
            </h4>
          </div>

          {estimatedHours > 0 && (
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
              <Clock size={11} className="text-slate-400" />
              <span>Logged: <strong className="text-slate-200">{loggedMinutes}m</strong> / {estimatedHours}h est.</span>
            </p>
          )}
        </div>

        {/* Big Countdown Clock */}
        <div className="my-4 flex flex-col items-center justify-center">
          <div className="font-mono text-4xl sm:text-5xl font-extrabold tracking-tight text-white drop-shadow-xs">
            {formattedTime}
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-800 h-2 rounded-full mt-3 overflow-hidden border border-slate-700/50">
            <div 
              className={`h-full transition-all duration-300 ${activeFocus.mode.includes('break') ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800">
          <div className="flex items-center gap-1.5">
            {activeFocus.isRunning ? (
              <button
                type="button"
                onClick={pauseFocusTimer}
                className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs px-3 py-1.5 rounded-xl border border-amber-500/40 transition-colors cursor-pointer"
              >
                <Pause size={14} />
                <span>Pause</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={resumeFocusTimer}
                className="flex items-center gap-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold text-xs px-3 py-1.5 rounded-xl border border-emerald-500/40 transition-colors cursor-pointer"
              >
                <Play size={14} />
                <span>{activeFocus.completed ? 'Start another' : 'Resume'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={resetFocusTimer}
              className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              title="Reset countdown"
              aria-label="Reset countdown"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenLogModal}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3 py-1.5 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <CheckCircle2 size={14} />
            <span>Finish & Log</span>
          </button>
        </div>

        {/* Presets: one 25 min preset, others behind small menu */}
        <div className="relative flex items-center justify-center gap-2 mt-3 pt-2 border-t border-slate-800/60">
          <button
            type="button"
            onClick={() => handleQuickPreset(25, 'pomodoro')}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
              activeFocus.durationSeconds === 1500 ? 'bg-blue-500/30 text-blue-200 border-blue-400' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            25 min
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPresetMenu(prev => !prev)}
              className="text-xs font-semibold px-2 py-1 rounded-lg border bg-slate-800 text-slate-400 border-slate-700 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
              aria-haspopup="true"
              aria-expanded={showPresetMenu}
            >
              <span>More</span>
              <ChevronDown size={12} className={showPresetMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>

            {showPresetMenu && (
              <div className="absolute bottom-full mb-1.5 right-0 w-36 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-1 z-50 animate-in fade-in zoom-in-95">
                <button
                  type="button"
                  onClick={() => {
                    handleQuickPreset(50, 'deep_work');
                    setShowPresetMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-slate-700 cursor-pointer ${
                    activeFocus.durationSeconds === 3000 ? 'text-blue-300 font-bold' : 'text-slate-300'
                  }`}
                >
                  50 min Deep
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleQuickPreset(5, 'short_break');
                    setShowPresetMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-slate-700 cursor-pointer ${
                    activeFocus.durationSeconds === 300 ? 'text-emerald-300 font-bold' : 'text-slate-300'
                  }`}
                >
                  5 min Break
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleQuickPreset(15, 'long_break');
                    setShowPresetMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-slate-700 cursor-pointer ${
                    activeFocus.durationSeconds === 900 ? 'text-emerald-300 font-bold' : 'text-slate-300'
                  }`}
                >
                  15 min Break
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Accessible manual log confirmation modal (V4-223) */}
      {showLogModal && (
        <div 
          onClick={handleLogModalBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
        >
          <div 
            ref={logModalRef}
            id="focus-log-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-effort-modal-title"
            tabIndex={-1}
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 text-slate-800"
          >
            <h3 id="log-effort-modal-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Flame size={18} className="text-blue-600" />
              Log Effort Minutes
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Record focused time toward <strong>{activeFocus.taskTitle}</strong>.
            </p>

            <div className="my-4">
              <label 
                htmlFor="log-effort-minutes-input"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Minutes to Log
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="log-effort-minutes-input"
                  type="number"
                  min="1"
                  max="480"
                  disabled={unloggedMinutes === 0}
                  value={unloggedMinutes === 0 ? 0 : customMinutesToLog}
                  onChange={(e) => setCustomMinutesToLog(Math.min(480, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-lg font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm font-semibold text-slate-500">mins</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {activeFocus.completed ? 'Interval completed and logged. Stop without logging it again.' : unloggedMinutes === 0 ? 'Less than 30 seconds elapsed. This session will stop without logging minutes.' : `Unlogged session time: ${unloggedMinutes} minute${unloggedMinutes === 1 ? '' : 's'}.`}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Keep Timing
              </button>
              <button
                type="button"
                onClick={handleConfirmLog}
                disabled={isLogging}
                className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isLogging ? 'Logging...' : unloggedMinutes === 0 ? 'Stop without logging' : 'Log & Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
