import { useState, useEffect } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { computeWeeklyWorkload } from '../services/workloadService';
import { isActionableTask, parseTaskDueDate, toVancouverDateString } from '../utils';
import { Task } from '../types';
import TaskBreakdownModal from './TaskBreakdownModal';
import {
  Target,
  Clock,
  Calendar,
  Calculator,
  GraduationCap,
  ListTree,
  Users,
  Bell,
  TrendingUp,
  Download,
  Smartphone,
  ChevronDown,
  ChevronRight,
  X,
  AlertCircle
} from 'lucide-react';

interface MoreToolsSectionProps {
  onNavigate?: (tab: any) => void;
}

export default function MoreToolsSection({ onNavigate }: MoreToolsSectionProps) {
  const {
    tasks,
    uiPrefs,
    updateUiPrefs,
    setViewMode,
    setFocusModeActive,
    isDemoMode,
  } = useTasksContext();
  const { isSimple } = useViewMode();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const [aiAvailable, setAiAvailable] = useState(true);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [selectedTaskForBreakdown, setSelectedTaskForBreakdown] = useState<Task | null>(null);
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState(false);
  const [showDesktopInstallInfo, setShowDesktopInstallInfo] = useState(false);

  const taskPickerModal = useModalFocus({ isOpen: taskPickerOpen, onClose: () => setTaskPickerOpen(false) });
  const iosInstallModal = useModalFocus({ isOpen: showIOSInstallGuide, onClose: () => setShowIOSInstallGuide(false) });
  const desktopInstallModal = useModalFocus({ isOpen: showDesktopInstallInfo, onClose: () => setShowDesktopInstallInfo(false) });

  // Probe /api/health for aiAvailable flag
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        if (active && typeof data.aiAvailable === 'boolean') {
          setAiAvailable(data.aiAvailable);
        }
      })
      .catch(() => {
        // Fallback gracefully
      });
    return () => {
      active = false;
    };
  }, []);

  // Compute inline verdict for row 2
  const workload = computeWeeklyWorkload(tasks);
  const nextWeekHours = workload.nextWeekHours;
  const isCrunch = workload.nextWeekIsCrunch;
  const nextWeekObj = workload.weeks[1];
  const intensity = nextWeekObj?.intensity ? nextWeekObj.intensity : 'light';
  const nextWeekVerdict = !nextWeekObj?.taskCount
    ? 'Next week: Nothing scheduled'
    : isCrunch
    ? `Next week: ${nextWeekHours} h — Crunch`
    : `Next week: ${nextWeekHours} h — ${{ light: 'Light', moderate: 'Moderate', heavy: 'Crunch' }[intensity]}`;

  // Helper to switch tab
  const navigateToTab = (tabName: string) => {
    if (onNavigate) {
      onNavigate(tabName);
      return;
    }
    // Expand secondary tools if in simple mode
    if (['Workload', 'Timetable', 'Groups', 'Progress', 'Announcements'].includes(tabName)) {
      updateUiPrefs({ moreToolsOpen: true });
    }
    setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(`button[aria-label="${tabName}"]`);
      if (btn) {
        btn.click();
        return;
      }
      const allButtons = Array.from(document.querySelectorAll('button'));
      const matched = allButtons.find(
        (b) => b.textContent?.trim() === tabName || b.querySelector('p')?.textContent?.trim() === tabName
      );
      if (matched) matched.click();
    }, 50);
  };

  // Helper to open Settings tab
  const openSettingsTab = (tabId: 'tab-calendar-btn' | 'tab-backup-btn') => {
    const settingsBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    if (settingsBtn) {
      settingsBtn.click();
      setTimeout(() => {
        const tabBtn = document.getElementById(tabId);
        if (tabBtn) tabBtn.click();
      }, 100);
    }
  };

  // Helper to open Grades Final Exam target
  const navigateToFinalExamTarget = () => {
    navigateToTab('Grades');
    setTimeout(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      const calcBtn = allButtons.find((b) => b.textContent?.includes('Standing & Calculator'));
      if (calcBtn) calcBtn.click();
    }, 60);
  };

  // Handle Install app click
  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSInstallGuide(true);
    } else {
      setShowDesktopInstallInfo(true);
    }
  };

  // State of collapse in Simple mode
  const isOpenInSimple = Boolean(uiPrefs.optionalToolsOpen);
  const isExpanded = !isSimple || isOpenInSimple;

  // Actionable tasks for breakdown picker
  const actionableTasks = tasks.filter(isActionableTask);

  // If in Simple mode and collapsed, render one 44 px row
  if (isSimple && !isExpanded) {
    return (
      <div className="border-t border-slate-200/80 pt-4">
        <button
          type="button"
          onClick={() => updateUiPrefs({ optionalToolsOpen: true })}
          aria-expanded={false}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors cursor-pointer min-h-[44px]"
        >
          <span className="uppercase tracking-wider text-xs font-bold text-slate-700">More tools</span>
          <ChevronDown size={16} className="text-slate-500" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200/80 pt-4 space-y-3">
      {/* Header & Subtitle */}
      {isSimple ? (
        <button
          type="button"
          onClick={() => updateUiPrefs({ optionalToolsOpen: false })}
          aria-expanded={true}
          className="w-full flex items-center justify-between text-left cursor-pointer group"
        >
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">More tools</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Extras for when you want them. Nothing here is required or changes your tasks or grades.
            </p>
          </div>
          <ChevronDown size={16} className="text-slate-500 group-hover:text-slate-700 transition-transform rotate-180 shrink-0 ml-3" />
        </button>
      ) : (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">More tools</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Extras for when you want them. Nothing here is required or changes your tasks or grades.
          </p>
        </div>
      )}

      {/* Rows Grid: 1 column at 375px, 2 columns from 640px */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
        {/* 1. Just one thing */}
        <button
          type="button"
          onClick={() => setFocusModeActive(true)}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Target size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">Focus on one task</p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Shows one task at a time, with an optional 25-minute timer.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 2. How busy is next week? */}
        <button
          type="button"
          onClick={() => navigateToTab('Workload')}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Clock size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">How busy is next week?</p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              {nextWeekVerdict}
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 3. Timetable and exam clashes */}
        <button
          type="button"
          onClick={() => navigateToTab('Timetable')}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Calendar size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">Timetable and exam clashes</p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Your classes, exams, and schedule conflicts.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 4. What do I need on the final? */}
        <button
          type="button"
          onClick={navigateToFinalExamTarget}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Calculator size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">What do I need on the final?</p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Target grade for each course, plus try-out scores.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 6. Break a task into steps (uses AI) */}
        <button
          type="button"
          onClick={() => setTaskPickerOpen(true)}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <ListTree size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-slate-900 leading-tight">Plan the steps</span>
            </div>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Turn one assignment into dated steps.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 7. Group projects */}
        <button
          type="button"
          onClick={() => navigateToTab('Groups')}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Users size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">Groups</p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Shared task list and milestones with a join code.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 8. Course notices (Simple only) */}
        {isSimple && (
          <button
            type="button"
            onClick={() => navigateToTab('Announcements')}
            className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
          >
            <Bell size={16} className="text-slate-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 leading-tight">Course notices</p>
              <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
                Announcements from imported course detailss.
              </p>
            </div>
            <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
          </button>
        )}

        {/* 9. How much you have finished (Simple only) */}
        {isSimple && (
          <button
            type="button"
            onClick={() => navigateToTab('Progress')}
            className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
          >
            <TrendingUp size={16} className="text-slate-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 leading-tight">How much you have finished</p>
              <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
                Completion and recently finished work.
              </p>
            </div>
            <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
          </button>
        )}

        {/* 10. Add my deadlines to my calendar app */}
        <button
          type="button"
          onClick={() => openSettingsTab('tab-calendar-btn')}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Calendar size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">
              Add my deadlines to my calendar app
            </p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Subscribe to your deadlines in your calendar app.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 11. Backup and export */}
        <button
          type="button"
          onClick={() => openSettingsTab('tab-backup-btn')}
          className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
        >
          <Download size={16} className="text-slate-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 leading-tight">Backup and export</p>
            <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
              Download a CSV or a full backup, or restore one.
            </p>
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
        </button>

        {/* 12. Install app (hidden when installed) */}
        {!isInstalled && (
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-left transition-colors cursor-pointer min-h-[44px]"
          >
            <Smartphone size={16} className="text-slate-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 leading-tight">Install app</p>
              <p className="text-xs text-slate-500 leading-tight truncate mt-0.5">
                Install app on this device for fast offline access.
              </p>
            </div>
            <ChevronRight size={14} className="text-slate-400 shrink-0 ml-auto" />
          </button>
        )}
      </div>

      {/* Footer text link */}
      <div className="pt-2 flex justify-start">
        {isSimple ? (
          <button
            type="button"
            onClick={() => setViewMode('detailed')}
            className="text-xs text-slate-500 hover:text-slate-800 underline decoration-slate-300 underline-offset-2 transition-colors cursor-pointer"
          >
            Show the detailed view
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setViewMode('simple')}
            className="text-xs text-slate-500 hover:text-slate-800 underline decoration-slate-300 underline-offset-2 transition-colors cursor-pointer"
          >
            Back to the simple view
          </button>
        )}
      </div>

      {/* Task Picker Modal for "Break a task into steps" */}
      {taskPickerOpen && (
        <div
          ref={taskPickerModal.modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-picker-title"
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-5 border border-slate-200 shadow-xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ListTree size={18} className="text-slate-700" />
                <h3 id="task-picker-title" className="text-sm font-bold text-slate-900">
                  Steps
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTaskPickerOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
                aria-label="Close task picker"
              >
                <X size={16} />
              </button>
            </div>

            {/* AI Availability Banner */}
            {isDemoMode ? (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-start gap-2">
                <AlertCircle size={14} className="text-slate-500 shrink-0 mt-0.5" />
                <span>Sign in with Google to use this</span>
              </div>
            ) : !aiAvailable ? (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-start gap-2">
                <AlertCircle size={14} className="text-slate-500 shrink-0 mt-0.5" />
                <span>Not available right now</span>
              </div>
            ) : null}

            {/* Content / Task Selection */}
            <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
              <p className="text-xs text-slate-500 mb-2">
                Select an assignment or exam to generate a dated, structured study plan:
              </p>

              {actionableTasks.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  No active coursework found. Add a task or import your courses first.
                </div>
              ) : (
                actionableTasks.map((t) => {
                  const dueDate = parseTaskDueDate(t.due_at);
                  const dateStr = dueDate ? toVancouverDateString(dueDate) : 'No due date';
                  return (
                    <button
                      key={t.task_id}
                      type="button"
                      onClick={() => {
                        setSelectedTaskForBreakdown(t);
                        setTaskPickerOpen(false);
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-colors cursor-pointer min-h-[44px]"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          {t.course && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {t.course}
                            </span>
                          )}
                          <span className="text-xs font-bold text-slate-900 truncate">{t.title}</span>
                        </div>
                        <p className="text-[11px] text-slate-500">Due: {dateStr}</p>
                      </div>
                      <ChevronRight size={14} className="text-slate-400 shrink-0" />
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setTaskPickerOpen(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Breakdown Modal */}
      {selectedTaskForBreakdown && (
        <TaskBreakdownModal
          task={selectedTaskForBreakdown}
          isOpen={Boolean(selectedTaskForBreakdown)}
          onClose={() => setSelectedTaskForBreakdown(null)}
        />
      )}

      {/* iOS Installation Guide Modal */}
      {showIOSInstallGuide && (
        <div
          ref={iosInstallModal.modalRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Install on iOS"
          aria-modal="true"
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone size={18} className="text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Install on iOS</h3>
              </div>
              <button
                type="button"
                aria-label="Close Install on iOS instructions"
                onClick={() => setShowIOSInstallGuide(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside pl-1">
              <li>Tap the <strong>Share</strong> button in Safari's bottom toolbar.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> in the top right corner.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSInstallGuide(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition cursor-pointer min-h-[44px]"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Desktop / In-browser Installation Info */}
      {showDesktopInstallInfo && (
        <div
          ref={desktopInstallModal.modalRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Install App"
          aria-modal="true"
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone size={18} className="text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Install App</h3>
              </div>
              <button
                type="button"
                aria-label="Close Install App instructions"
                onClick={() => setShowDesktopInstallInfo(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              To install this dashboard as a desktop app, click the <strong>Install</strong> icon in your browser's address bar (or browser menu &rarr; &quot;Install app&quot;).
            </p>
            <button
              type="button"
              onClick={() => setShowDesktopInstallInfo(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition cursor-pointer min-h-[44px]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
