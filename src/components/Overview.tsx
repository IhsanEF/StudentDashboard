import { useState } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { useViewMode } from '../hooks/useViewMode';
import { parseTaskDueDate, toVancouverDateString, isWithinNext7VancouverDays, isActiveAcademicTask, isActionableTask, isTaskDueToday } from '../utils';
import { pickNextTasks } from '../services/focusService';
import { computeWeeklyWorkload } from '../services/workloadService';
import { TabType } from '../types';
import TaskCard from './TaskCard';
import WorkloadSummaryCard from './WorkloadSummaryCard';
import ReviewInboxLine from './ReviewInboxLine';
import MoreToolsSection from './MoreToolsSection';
import AddTaskModal from './AddTaskModal';
import { ChevronRight } from 'lucide-react';

interface OverviewProps {
  onNavigate?: (tab: TabType, initialGroup?: string) => void;
}

export default function Overview({ onNavigate }: OverviewProps) {
  const { tasks, now, setFocusModeActive, openImport, loading } = useTasksContext();
  const { isSimple } = useViewMode();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" aria-label="Loading overview" role="status">
        <span className="sr-only">Loading overview...</span>
        {/* 1. Up next skeleton */}
        <section>
          <div className="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded-lg mb-3" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="h-36 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
            <div className="h-36 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-800 hidden md:block" />
            <div className="h-36 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-800 hidden xl:block" />
          </div>
        </section>

        {/* 2. Counts skeleton */}
        <div className={isSimple ? "grid grid-cols-3 gap-3 sm:gap-4" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4"}>
          {(isSimple ? [1, 2, 3] : [1, 2, 3, 4, 5, 6]).map(i => (
            <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
          ))}
        </div>

        {/* 3. Workload skeleton */}
        <div className="h-28 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
      </div>
    );
  }

  // 1. Up next tasks (up to 3)
  const upNext = pickNextTasks(tasks).slice(0, 3);

  // 2. Counts
  const actionableTasks = tasks.filter(isActionableTask);
  const todayVancouver = toVancouverDateString(now);

  // "Due today" must count anything due on today's Vancouver date
  const dueToday = actionableTasks.filter(t => isTaskDueToday(t, now));

  // "Past due" (amber, not red)
  const pastDue = actionableTasks.filter(t => {
    if (!t.due_at) return false;
    const dueDate = parseTaskDueDate(t.due_at);
    if (!dueDate) return false;
    return toVancouverDateString(dueDate) < todayVancouver;
  });

  // "Next 7 days"
  const next7Days = actionableTasks.filter(t => {
    if (!t.due_at) return false;
    const dueDate = parseTaskDueDate(t.due_at);
    if (!dueDate) return false;
    const taskDateStr = toVancouverDateString(dueDate);
    if (taskDateStr <= todayVancouver) return false;
    return isWithinNext7VancouverDays(dueDate, now);
  });

  const working = actionableTasks.filter(t => t.status === 'Working');
  const academicTasks = tasks.filter(isActiveAcademicTask);
  const submitted = academicTasks.filter(t => t.status === 'Submitted');
  const completed = academicTasks.filter(t => t.status === 'Done');

  const statTiles = isSimple
    ? [
        { label: 'Past due', count: pastDue.length, initialGroup: 'Past due', countColor: 'text-amber-700', labelColor: 'text-amber-800/80' },
        { label: 'Due today', count: dueToday.length, initialGroup: 'Due today', countColor: 'text-slate-800', labelColor: 'text-slate-500' },
        { label: 'Next 7 days', count: next7Days.length, initialGroup: 'Next 7 days', countColor: 'text-slate-800', labelColor: 'text-slate-500' },
      ]
    : [
        { label: 'Past due', count: pastDue.length, initialGroup: 'Past due', countColor: 'text-amber-700', labelColor: 'text-amber-800/80' },
        { label: 'Due today', count: dueToday.length, initialGroup: 'Due today', countColor: 'text-slate-800', labelColor: 'text-slate-500' },
        { label: 'Next 7 days', count: next7Days.length, initialGroup: 'Next 7 days', countColor: 'text-slate-800', labelColor: 'text-slate-500' },
        { label: 'Working', count: working.length, initialGroup: 'Working', countColor: 'text-purple-700', labelColor: 'text-purple-700/80' },
        { label: 'Submitted', count: submitted.length, initialGroup: 'Submitted', countColor: 'text-teal-700', labelColor: 'text-teal-700/80' },
        { label: 'Done', count: completed.length, initialGroup: 'Done', countColor: 'text-emerald-700', labelColor: 'text-emerald-700/80' },
      ];

  // 4. Workload crunch week check
  const workloadSummary = computeWeeklyWorkload(tasks, undefined, undefined, now);
  const nextWeekIsCrunch = workloadSummary.nextWeekIsCrunch;
  const nextWeekHours = workloadSummary.nextWeekHours;

  // 5. Add coursework strip check
  const showAddCourseworkStrip = tasks.length < 3;

  return (
    <div className="space-y-6">
      {/* 1. Up next */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-3">
          <h2 className="text-lg font-bold text-slate-900">Up next</h2>
        </div>

        {upNext.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {upNext.map(task => (
              <TaskCard key={task.task_id} task={task} />
            ))}
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-500">
            {tasks.length === 0
              ? 'Nothing here yet. Add a task by hand or upload a course outline to bring in your deadlines.'
              : 'Nothing due soon.'}
          </div>
        )}
      </section>

      {/* 2. Counts */}
      <div className={isSimple ? "grid grid-cols-3 gap-3 sm:gap-4" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4"}>
        {statTiles.map(tile => (
          <button
            key={tile.label}
            type="button"
            onClick={() => onNavigate && onNavigate('Tasks', tile.initialGroup)}
            className="group bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-xs text-left hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer w-full flex flex-col justify-between"
          >
            <div>
              <p className={`text-xs font-semibold mb-1 ${tile.labelColor}`}>{tile.label}</p>
              <p className={`text-2xl font-black ${tile.countColor}`}>{tile.count}</p>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 group-hover:text-blue-600 transition-colors mt-2 pt-2 border-t border-slate-100">
              <span>View</span>
              <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        ))}
      </div>

      {/* 3. Review Inbox Line */}
      <ReviewInboxLine />

      {/* 4. Workload crunch / WorkloadSummaryCard */}
      {isSimple ? (
        nextWeekIsCrunch && (
          <div className="px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 flex items-center justify-between">
            <span>
              Next week: Crunch ({nextWeekHours} h) —{' '}
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('Workload')}
                className="text-slate-700 hover:text-slate-900 font-semibold underline cursor-pointer"
              >
                see why
              </button>
            </span>
          </div>
        )
      ) : (
        <WorkloadSummaryCard onNavigate={onNavigate} />
      )}

      {/* 5. Add coursework strip */}
      {showAddCourseworkStrip && (
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-700">
          <p className="text-xs sm:text-sm text-slate-600">
            Add subjects and tasks manually, or upload a course outline to preview your deadlines.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openImport('file')}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-2xs cursor-pointer"
            >
              Upload a course outline
            </button>
            <button
              type="button"
              onClick={() => setIsQuickAddOpen(true)}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Add a task
            </button>
          </div>
        </div>
      )}

      {/* 6. More Tools Section */}
      <MoreToolsSection />

      {/* 7. Quiet Focus Mode Link */}
      <div className="text-center pt-2 pb-4">
        <button
          type="button"
          onClick={() => setFocusModeActive(true)}
          className="text-xs text-slate-400 hover:text-slate-600 underline decoration-slate-300 underline-offset-2 transition-colors cursor-pointer"
        >
          Focus on one task
        </button>
      </div>

      {/* Add Task Modal */}
      <AddTaskModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
      />
    </div>
  );
}
