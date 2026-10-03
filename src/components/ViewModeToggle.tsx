import React, { useRef } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { ViewMode } from '../types';

export interface ViewModeToggleProps {
  variant?: 'sidebar' | 'sheet' | 'settings';
  className?: string;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  variant = 'sidebar',
  className = ''
}) => {
  const { uiPrefs, setViewMode, showToast } = useTasksContext();
  const viewMode: ViewMode = uiPrefs.viewMode || 'simple';

  const simpleRef = useRef<HTMLButtonElement>(null);
  const detailedRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (mode: ViewMode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    showToast({
      message: mode === 'simple' ? 'Switched to Simple view' : 'Switched to Detailed view'
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentMode: ViewMode) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMode === 'simple') {
        handleSelect('detailed');
        detailedRef.current?.focus();
      } else {
        handleSelect('simple');
        simpleRef.current?.focus();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentMode === 'detailed') {
        handleSelect('simple');
        simpleRef.current?.focus();
      } else {
        handleSelect('detailed');
        detailedRef.current?.focus();
      }
    }
  };

  const renderRadioGroup = (containerClasses: string, activeBtnClasses: string, inactiveBtnClasses: string) => (
    <div
      role="radiogroup"
      aria-label="Dashboard view"
      className={containerClasses}
    >
      <button
        ref={simpleRef}
        type="button"
        role="radio"
        aria-checked={viewMode === 'simple'}
        tabIndex={viewMode === 'simple' ? 0 : -1}
        title="Just what is due, your courses and grades."
        onClick={() => handleSelect('simple')}
        onKeyDown={(e) => handleKeyDown(e, 'simple')}
        className={viewMode === 'simple' ? activeBtnClasses : inactiveBtnClasses}
      >
        Simple
      </button>
      <button
        ref={detailedRef}
        type="button"
        role="radio"
        aria-checked={viewMode === 'detailed'}
        tabIndex={viewMode === 'detailed' ? 0 : -1}
        title="Everything at once: workload, timetable, groups, calculators and every task option."
        onClick={() => handleSelect('detailed')}
        onKeyDown={(e) => handleKeyDown(e, 'detailed')}
        className={viewMode === 'detailed' ? activeBtnClasses : inactiveBtnClasses}
      >
        Detailed
      </button>
    </div>
  );

  if (variant === 'settings') {
    return (
      <div className={`p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2.5 ${className}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
              Dashboard view
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed max-w-lg">
              Simple shows only what is due and how to get your coursework in. Detailed adds workload, timetable, groups and grade tools. You can switch any time.
            </p>
          </div>
          <div className="shrink-0 self-start sm:self-center">
            {renderRadioGroup(
              "inline-flex items-center p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xs",
              "px-3.5 py-1.5 text-xs font-bold text-blue-900 dark:text-white bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-lg shadow-2xs transition-all cursor-pointer",
              "px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-lg transition-all cursor-pointer"
            )}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'sheet') {
    return (
      <div className={`w-full ${className}`}>
        {renderRadioGroup(
          "w-full grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl",
          "w-full py-2 text-center text-xs font-bold text-blue-950 dark:text-white bg-white dark:bg-slate-900 rounded-lg shadow-2xs transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700",
          "w-full py-2 text-center text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-lg transition-all cursor-pointer"
        )}
      </div>
    );
  }

  // Default: 'sidebar'
  return (
    <div className={`w-full ${className}`}>
      {renderRadioGroup(
        "w-full grid grid-cols-2 p-1 bg-white/10 rounded-xl border border-white/10",
        "w-full py-1.5 text-center text-xs font-bold text-[#002145] bg-white rounded-lg shadow-2xs transition-all cursor-pointer",
        "w-full py-1.5 text-center text-xs font-medium text-blue-100 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer"
      )}
    </div>
  );
};

export default ViewModeToggle;
