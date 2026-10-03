import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { computeWeeklyWorkload, getVancouverMondayDateStr, getTaskEstimatedHours, WeekWorkload, DayWorkload, CourseHoursBreakdown } from '../services/workloadService';
import { 
  Flame, 
  Clock, 
  Calendar, 
  AlertTriangle, 
  CheckCircle2, 
  Sparkles, 
  ChevronRight, 
  BarChart3, 
  Layers, 
  Sliders, 
  ArrowRight,
  TrendingUp,
  Info,
  CalendarDays
} from 'lucide-react';
import { formatReadableDate, getCourseColor, parseTaskDueDate, pluralize } from '../utils';
import { Task, TabType } from '../types';
import EditTaskModal from './EditTaskModal';
import TaskCard from './TaskCard';

export default function WorkloadTab({ onNavigate }: { onNavigate?: (tab: TabType) => void }) {
  const { tasks, now, notificationPrefs, updateNotificationPrefs, updateTask } = useTasksContext();
  const [thresholdHours, setThresholdHours] = useState(notificationPrefs?.workloadThresholdHours || 15);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(0);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedTaskForEdit, setSelectedTaskForEdit] = useState<Task | null>(null);
  const [showThresholdSettings, setShowThresholdSettings] = useState(false);
  const [isLaterSelected, setIsLaterSelected] = useState(false);
  const committedThreshold = useRef(thresholdHours);
  const thresholdWrites = useRef(Promise.resolve());
  const prefsRef = useRef(notificationPrefs);
  prefsRef.current = notificationPrefs;

  useEffect(() => {
    if (notificationPrefs?.workloadThresholdHours && notificationPrefs.workloadThresholdHours !== thresholdHours) {
      setThresholdHours(notificationPrefs.workloadThresholdHours);
    }
    committedThreshold.current = notificationPrefs?.workloadThresholdHours || 15;
  }, [notificationPrefs?.workloadThresholdHours]);

  // Compute weekly workload rollups
  const workload = useMemo(() => {
    const monday = Date.parse(getVancouverMondayDateStr(now));
    const numWeeks = tasks.reduce((weeks, task) => {
      if (['done', 'submitted', 'read'].includes((task.status || '').toLowerCase()) || task.type === 'announcement') return weeks;
      const due = parseTaskDueDate(task.due_at);
      if (!due) return weeks;
      const dueMonday = Date.parse(getVancouverMondayDateStr(due));
      return Math.max(weeks, Math.round((dueMonday - monday) / (7 * 86400000)) + 1);
    }, 6);
    return computeWeeklyWorkload(tasks, thresholdHours, numWeeks, now);
  }, [tasks, thresholdHours, now]);

  // Count the same tasks whose hours are included in the timeline.
  const pipelineTaskIds = useMemo(() => {
    const ids = new Set<string>();
    workload.weeks.forEach(w => {
      w.tasks.forEach(t => ids.add(t.task_id));
    });
    return ids;
  }, [workload.weeks]);

  const pipelineTaskCount = pipelineTaskIds.size;

  // Tasks due beyond the 6-week horizon (Week 7+) or overdue
  const { laterTasks, laterHours, overdueTasks, overdueHours } = useMemo(() => {
    if (!workload.weeks || workload.weeks.length === 0) {
      return { laterTasks: [], laterHours: 0, overdueTasks: [], overdueHours: 0 };
    }
    const firstStart = workload.weeks[0].startDate;
    const lastEnd = workload.weeks[workload.weeks.length - 1].endDate;

    const later: Task[] = [];
    let laterH = 0;
    const overdue: Task[] = [];
    let overdueH = 0;

    tasks.forEach(t => {
      if (t.status === 'Done' || t.status === 'Submitted' || t.type === 'announcement' || !t.due_at) {
        return;
      }
      const due = parseTaskDueDate(t.due_at);
      if (!due) return;

      if (due > lastEnd) {
        later.push(t);
        laterH += getTaskEstimatedHours(t);
      } else if (due < firstStart) {
        overdue.push(t);
        overdueH += getTaskEstimatedHours(t);
      }
    });

    return {
      laterTasks: later.sort((a, b) => {
        const dateA = parseTaskDueDate(a.due_at)?.getTime() || 0;
        const dateB = parseTaskDueDate(b.due_at)?.getTime() || 0;
        return dateA - dateB;
      }),
      laterHours: Math.round(laterH * 10) / 10,
      overdueTasks: overdue,
      overdueHours: Math.round(overdueH * 10) / 10
    };
  }, [tasks, workload.weeks]);

  const intensityLabels = { light: 'Light', moderate: 'Moderate', heavy: 'Crunch' };

  const selectedWeek: WeekWorkload = workload.weeks[selectedWeekIndex] || workload.weeks[0];

  const laterCourseList = useMemo(() => {
    const map: Record<string, CourseHoursBreakdown> = {};
    laterTasks.forEach(t => {
      const c = t.course || 'Other';
      if (!map[c]) {
        map[c] = {
          course: c,
          hours: 0,
          taskCount: 0,
          colorClass: getCourseColor(c)
        };
      }
      map[c].hours += getTaskEstimatedHours(t);
      map[c].taskCount += 1;
    });
    return Object.values(map)
      .map(c => ({ ...c, hours: Math.round(c.hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);
  }, [laterTasks]);

  const displayedCourseList = isLaterSelected ? laterCourseList : selectedWeek.courseList;

  const fullDayNames: Record<string, string> = {
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
    Sun: 'Sunday'
  };

  const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

  // Dynamic study advice (Item 1: V3-438)
  const studyAdvice = useMemo(() => {
    if (isLaterSelected) {
      return `💡 You have ${laterTasks.length} ${pluralize(laterTasks.length, 'task')} (${laterHours}h) due beyond Week 6. Starting early on final projects and term papers distributes your workload smoothly.`;
    }

    if (!selectedWeek || selectedWeek.tasks.length === 0 || selectedWeek.totalHours === 0) {
      return 'No deadlines imported for this week yet — import a syllabus to see your real load.';
    }

    const activeDays = selectedWeek.days.filter(d => d.totalHours > 0);
    const activeDaysCount = activeDays.length;
    const activeDaysText = numberWords[activeDaysCount] || `${activeDaysCount}`;
    const dayLabel = activeDaysCount === 1 ? 'day' : 'days';

    // Find the busiest day
    let busiestDay = selectedWeek.days[0];
    for (const d of selectedWeek.days) {
      if (d.totalHours > busiestDay.totalHours) {
        busiestDay = d;
      }
    }

    const busiestDayHours = busiestDay.totalHours;
    const isSkewed = selectedWeek.totalHours > 0 && (busiestDayHours / selectedWeek.totalHours) > 0.40;
    const busiestDayName = fullDayNames[busiestDay.dayName] || busiestDay.dayName;

    if (isSkewed) {
      const lighterDays = selectedWeek.days
        .filter(d => d.dateKey !== busiestDay.dateKey && d.totalHours <= 1.5)
        .map(d => fullDayNames[d.dayName] || d.dayName);

      const topTask = busiestDay.tasks.length > 0
        ? busiestDay.tasks.reduce((max, t) => getTaskEstimatedHours(t) > getTaskEstimatedHours(max) ? t : max, busiestDay.tasks[0])
        : null;
      const taskDescriptor = topTask ? (topTask.type === 'assignment' || topTask.type === 'project' || topTask.type === 'reading' || topTask.type === 'quiz' ? topTask.type : 'essay') : 'essay';

      let shiftAdvice = 'Moving some work earlier in the week would even it out.';
      if (lighterDays.length >= 2) {
        shiftAdvice = `Moving some of the ${taskDescriptor} work to ${lighterDays[lighterDays.length - 2]} or ${lighterDays[lighterDays.length - 1]} would even it out.`;
      } else if (lighterDays.length === 1) {
        shiftAdvice = `Moving some of the ${taskDescriptor} work to ${lighterDays[0]} would even it out.`;
      }

      if (selectedWeek.intensity === 'heavy') {
        return `⚡ Crunch week (${selectedWeek.totalHours}h). Most of this week's ${selectedWeek.totalHours}h lands on ${busiestDayName} (${busiestDayHours}h). ${shiftAdvice}`;
      }
      return `Most of this week's ${selectedWeek.totalHours}h lands on ${busiestDayName} (${busiestDayHours}h). ${shiftAdvice}`;
    }

    if (selectedWeek.intensity === 'heavy') {
      return `⚡ This is a Crunch week with ${selectedWeek.totalHours} ${pluralize(selectedWeek.totalHours, 'hour')} of work spread across ${activeDaysText} ${dayLabel}. Use the Step Breakdown tool on large assignments to start working on draft tasks 4–5 days early!`;
    }

    return `About ${selectedWeek.totalHours}h this week, spread across ${activeDaysText} ${dayLabel} — a good window to get ahead.`;
  }, [isLaterSelected, laterTasks.length, laterHours, selectedWeek]);

  const handleCommitThreshold = (newVal: number) => {
    if (newVal === committedThreshold.current) return;
    committedThreshold.current = newVal;
    thresholdWrites.current = thresholdWrites.current.then(async () => {
      await updateNotificationPrefs({ ...prefsRef.current, workloadThresholdHours: newVal });
    }).catch(e => {
      committedThreshold.current = prefsRef.current?.workloadThresholdHours || 15;
      console.warn('Failed to update threshold:', e);
    });
  };

  const handleQuickAdjustHours = async (task: Task, delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = getTaskEstimatedHours(task);
    const updated = Math.max(0.5, Math.round((current + delta) * 10) / 10);
    await updateTask(task.task_id, {
      estimated_hours: updated,
      last_interaction_at: new Date().toISOString()
    });
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Next Week Load */}
        <div className={`p-4 rounded-2xl border transition-all ${
          workload.weeks[1]?.intensity === 'heavy'
            ? 'bg-gradient-to-br from-rose-50 to-orange-50 border-rose-200 text-rose-950 shadow-xs'
            : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Next Week Load</span>
            {!workload.weeks[1]?.taskCount ? (
              <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Nothing scheduled</span>
            ) : workload.weeks[1]?.intensity === 'heavy' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500 text-white animate-pulse">
                <Flame size={12} /> Crunch
              </span>
            ) : workload.weeks[1]?.intensity === 'moderate' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                Moderate
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                <CheckCircle2 size={12} /> Light
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{workload.nextWeekHours}h</span>
            <span className="text-xs font-medium text-slate-500">
              {workload.weeks[1]?.taskCount || 0} {pluralize(workload.weeks[1]?.taskCount || 0, 'task')}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            {!workload.weeks[1]?.taskCount
              ? 'No deadlines imported for this week yet — import a syllabus to see your real load.'
              : workload.weeks[1]?.intensity === 'heavy'
              ? `⚠️ Exceeds your ${thresholdHours}h weekly limit. Plan ahead!`
              : `Under the ${thresholdHours}h a week you set.`}
          </p>
        </div>

        {/* This Week Load */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">This Week Load</span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              !workload.weeks[0]?.taskCount
                ? 'bg-slate-100 text-slate-600'
                : workload.weeks[0]?.intensity === 'heavy'
                ? 'bg-rose-100 text-rose-800' 
                : workload.weeks[0]?.intensity === 'moderate'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-emerald-100 text-emerald-800'
            }`}>
              {!workload.weeks[0]?.taskCount ? 'Nothing scheduled' : workload.weeks[0]?.intensity === 'heavy' ? 'Crunch' : workload.weeks[0]?.intensity === 'moderate' ? 'Moderate' : 'Light'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{workload.thisWeekHours}h</span>
            <span className="text-xs font-medium text-slate-500">
              {workload.weeks[0]?.taskCount || 0} active {pluralize(workload.weeks[0]?.taskCount || 0, 'task')}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {workload.weeks[0]?.dateRangeFormatted}
          </p>
        </div>

        {/* Busiest week ahead */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Busiest week ahead</span>
            <TrendingUp size={16} className="text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-indigo-900">{workload.maxWeekHours}h</span>
            <span className="text-xs font-medium text-slate-500">busiest week</span>
          </div>
          <p className="text-xs text-indigo-700 font-semibold mt-2 truncate">
            {workload.peakWeekLabel}
          </p>
        </div>

        {/* 6-Week Work Pipeline -> Total remaining work */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total remaining work</span>
            <button 
              type="button"
              aria-label="Customize weekly workload threshold"
              aria-expanded={showThresholdSettings}
              aria-controls="workload-threshold-settings"
              onClick={() => setShowThresholdSettings(!showThresholdSettings)}
              className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Sliders size={12} />
              <span>Limit: {thresholdHours}h</span>
            </button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{workload.totalUpcomingHours}h</span>
            <span className="text-xs font-medium text-slate-500">
              across {pipelineTaskCount} {pluralize(pipelineTaskCount, 'task')}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-2 flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span>Avg {workload.averageWeeklyHours}h / week</span>
              {laterTasks.length > 0 && (
                <span className="text-amber-700 font-semibold" title={`${laterTasks.length} pending ${pluralize(laterTasks.length, 'task')} (${laterHours}h) due beyond week 6`}>
                  +{laterTasks.length} later ({laterHours}h)
                </span>
              )}
            </div>
            {overdueTasks.length > 0 && (
              <span className="text-rose-600 text-[11px] font-medium">
                (includes {overdueTasks.length} overdue task{overdueTasks.length === 1 ? '' : 's'}: {overdueHours}h)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Threshold Setting Drawer */}
      {showThresholdSettings && (
        <div id="workload-threshold-settings" className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-blue-950 flex items-center gap-2">
              <Flame className="text-rose-500" size={16} />
              <span>Customize "Crunch Week" Workload Threshold</span>
            </h4>
            <p className="text-xs text-blue-700 mt-0.5">
              Weeks with estimated hours at or above this number will be labelled Crunch.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input 
              type="range"
              aria-label="Weekly workload threshold in hours"
              min="8"
              max="35"
              step="1"
              value={thresholdHours}
              onChange={(e) => setThresholdHours(parseInt(e.target.value, 10))}
              onPointerUp={(e) => handleCommitThreshold(Number(e.currentTarget.value))}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                  handleCommitThreshold(Number(e.currentTarget.value));
                }
              }}
              onBlur={(e) => handleCommitThreshold(Number(e.currentTarget.value))}
              className="accent-blue-600 w-full sm:w-48"
            />
            <span className="px-3 py-1.5 bg-white border border-blue-200 rounded-xl text-sm font-black text-blue-900 min-w-[50px] text-center shadow-xs">
              {thresholdHours}h
            </span>
          </div>
        </div>
      )}

      {/* 6-Week Heatmap & Bar Chart Timeline */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="text-blue-600" size={18} />
              <span>Next {workload.weeks.length} weeks</span>
            </h3>
            <p className="text-xs text-slate-500">
              Tap a week to see which days it lands on.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> &lt; {Math.round(thresholdHours * 0.55 * 10) / 10}h Light</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> {Math.round(thresholdHours * 0.55 * 10) / 10}–&lt;{thresholdHours}h Moderate</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> &ge; {thresholdHours}h Crunch</span>
          </div>
        </div>

        {/* Week Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {workload.weeks.map((w, idx) => {
            const isSelected = !isLaterSelected && selectedWeekIndex === idx;
            const heightPercent = Math.min(100, Math.max(12, (w.totalHours / Math.max(workload.maxWeekHours, 20)) * 100));

            let barColor = 'bg-emerald-500';
            let badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200';
            if (w.intensity === 'heavy') {
              barColor = 'bg-gradient-to-t from-rose-600 to-orange-500';
              badgeStyle = 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold';
            } else if (w.intensity === 'moderate') {
              barColor = 'bg-blue-500';
              badgeStyle = 'bg-blue-50 text-blue-700 border-blue-200';
            }

            return (
              <button
                type="button"
                key={idx}
                aria-label={`${w.weekLabel}, ${w.dateRangeFormatted}: ${w.totalHours} ${pluralize(w.totalHours, 'hour')}, ${w.taskCount} ${pluralize(w.taskCount, 'task')}, ${w.taskCount === 0 ? 'Nothing scheduled' : intensityLabels[w.intensity]}`}
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedWeekIndex(idx);
                  setSelectedDayKey(null);
                  setIsLaterSelected(false);
                }}
                className={`w-full p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between text-left ${
                  isSelected 
                    ? 'ring-2 ring-blue-600 border-transparent bg-blue-50/40 shadow-sm' 
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/60 hover:bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-800 truncate">{w.weekLabel}</span>
                    {w.intensity === 'heavy' && <Flame size={14} className="text-rose-600 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-slate-500">{w.dateRangeFormatted}</p>
                </div>

                {/* Vertical Bar Meter */}
                <div className="my-3 flex items-end justify-center h-20 bg-slate-200/50 rounded-lg p-1.5 overflow-hidden">
                  <div 
                    style={{ height: `${heightPercent}%` }}
                    className={`w-full rounded-md transition-all duration-300 ${barColor}`}
                  />
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                  <span className="text-sm font-black text-slate-900">{w.totalHours}h</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-semibold ${badgeStyle}`}>
                    {w.taskCount} {w.taskCount === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Later Bucket Callout */}
        {laterTasks.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50/70 rounded-xl p-3 border border-amber-200/80">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-900 font-extrabold text-[11px] uppercase tracking-wide">
                Later Bucket
              </span>
              <span className="text-xs font-bold text-slate-800">
                Week 7+ Horizon: {laterTasks.length} {pluralize(laterTasks.length, 'task')} ({laterHours}h estimated effort)
              </span>
            </div>
            <button
              type="button"
              aria-pressed={isLaterSelected}
              onClick={() => {
                setIsLaterSelected(!isLaterSelected);
                setSelectedDayKey(null);
              }}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                isLaterSelected 
                  ? 'bg-amber-600 text-white border-amber-700 shadow-xs' 
                  : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
            >
              {isLaterSelected ? '✓ Viewing Later Tasks' : 'Inspect Later Tasks →'}
            </button>
          </div>
        )}
      </div>

      {/* Selected Week / Later Deep-Dive Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Day-by-day Breakdown & Tasks */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <CalendarDays className="text-indigo-600" size={18} />
                  <span>{isLaterSelected ? 'Later Tasks (Beyond Week 6)' : `Daily Breakdown: ${selectedWeek.weekLabel}`}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  {isLaterSelected 
                    ? `${laterTasks.length} ${pluralize(laterTasks.length, 'task')} scheduled beyond the 6-week horizon • Total ${laterHours} ${pluralize(laterHours, 'hour')}`
                    : `${selectedWeek.dateRangeFormatted} • Total ${selectedWeek.totalHours} ${pluralize(selectedWeek.totalHours, 'hour')} across ${selectedWeek.taskCount} ${pluralize(selectedWeek.taskCount, 'task')}`}
                </p>
              </div>

              {!isLaterSelected && selectedWeek.intensity === 'heavy' && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs font-bold">
                  <Flame size={14} className="text-rose-600" />
                  <span>Crunch Week (&ge; {thresholdHours}h)</span>
                </div>
              )}
            </div>

            {/* 7-Day Tiles or Later Info */}
            {isLaterSelected ? (
              <div className="mb-6 p-4 rounded-xl bg-amber-50/50 border border-amber-200/70 text-xs text-amber-900 flex items-center gap-2">
                <Info size={16} className="text-amber-600 shrink-0" />
                <span>
                  These tasks are scheduled 7+ weeks out. Keep them on your radar early to avoid crunch periods at term end.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-6">
                {selectedWeek.days.map((day: DayWorkload) => {
                  const isDaySelected = selectedDayKey === day.dateKey;
                  const hasWork = day.totalHours > 0;
                  let dayBg = 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700';
                  if (day.isToday) dayBg = 'bg-blue-50/80 border-blue-300 text-blue-900 font-bold';
                  if (isDaySelected) dayBg = 'ring-2 ring-indigo-600 bg-indigo-50 border-indigo-300 text-indigo-950';

                  return (
                    <button
                      type="button"
                      key={day.dateKey}
                      aria-label={`${fullDayNames[day.dayName]} ${day.dateKey}: ${day.totalHours} ${pluralize(day.totalHours, 'hour')}, ${day.tasks.length} ${pluralize(day.tasks.length, 'task')}`}
                      aria-pressed={isDaySelected}
                      onClick={() => setSelectedDayKey(isDaySelected ? null : day.dateKey)}
                      className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${dayBg}`}
                    >
                      <span className="text-[11px] block text-slate-500 uppercase">{day.dayName}</span>
                      <span className="text-sm font-bold block my-0.5">{day.dayNumber}</span>
                      <span className={`text-[10px] px-1 py-0.5 rounded font-extrabold block ${
                        day.totalHours >= 6 ? 'bg-rose-200 text-rose-900' :
                        day.totalHours >= 3 ? 'bg-amber-200 text-amber-900' :
                        hasWork ? 'bg-emerald-200 text-emerald-900' : 'text-slate-400'
                      }`}>
                        {hasWork ? `${day.totalHours}h` : '–'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* List of Tasks in Selected Week / Day */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  {isLaterSelected
                    ? `Later Tasks (${laterTasks.length})`
                    : selectedDayKey 
                      ? `Tasks Due on Selected Day (${selectedWeek.days.find(d => d.dateKey === selectedDayKey)?.dayName} ${selectedWeek.days.find(d => d.dateKey === selectedDayKey)?.dayNumber})` 
                      : `Due this week (${selectedWeek.tasks.length})`}
                </h4>
                <div className="flex items-center gap-2">
                  {onNavigate && (
                    <>
                      <button
                        type="button"
                        onClick={() => onNavigate('Tasks')}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors"
                        title="View tasks in Tasks tab"
                      >
                        <span>View in Tasks</span>
                        <ArrowRight size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('Timetable')}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
                        title="View in Timetable schedule"
                      >
                        <span>View in Timetable</span>
                        <ArrowRight size={12} />
                      </button>
                    </>
                  )}
                  {selectedDayKey && (
                    <button
                      type="button"
                      onClick={() => setSelectedDayKey(null)}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-800 underline ml-1 cursor-pointer"
                    >
                      All week
                    </button>
                  )}
                </div>
              </div>

              {(isLaterSelected ? laterTasks : (selectedDayKey 
                ? selectedWeek.tasks.filter(t => {
                    const dayMatch = selectedWeek.days.find(d => d.dateKey === selectedDayKey);
                    return dayMatch?.tasks.some(dt => dt.task_id === t.task_id);
                  })
                : selectedWeek.tasks)
              ).length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500 text-sm">
                  {isLaterSelected ? '🌴 No tasks scheduled beyond Week 6!' : 'No deadlines imported for this week yet — import a syllabus to see your real load.'}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {(isLaterSelected ? laterTasks : (selectedDayKey 
                    ? selectedWeek.tasks.filter(t => {
                        const dayMatch = selectedWeek.days.find(d => d.dateKey === selectedDayKey);
                        return dayMatch?.tasks.some(dt => dt.task_id === t.task_id);
                      })
                    : selectedWeek.tasks)
                  ).map(task => {
                    const hours = getTaskEstimatedHours(task);
                    const courseColor = getCourseColor(task.course);

                    return (
                      <div
                        key={task.task_id}
                        className="w-full text-left p-3.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-xs transition-all flex items-center justify-between gap-3 group"
                      >
                        <button type="button" onClick={() => setSelectedTaskForEdit(task)}
                          aria-label={`Edit ${task.title}`}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer">
                          <span className={`text-xs font-bold px-2 py-1 rounded-lg shrink-0 border ${courseColor}`}>
                            {task.course}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                              {task.title}
                            </p>
                            <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                              <span className="flex items-center gap-1 font-medium">
                                <Calendar size={12} className="text-slate-400" />
                                {formatReadableDate(task.due_at)}
                              </span>
                              {task.subtasks && task.subtasks.length > 0 && (
                                <span className="text-indigo-600 font-semibold">
                                  &bull; {task.subtasks.filter(s => s.done).length}/{task.subtasks.length} {pluralize(task.subtasks.length, 'step')} done
                                </span>
                              )}
                            </p>
                          </div>
                        </button>

                        {/* Effort Controller */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 text-xs font-bold">
                            <button
                              type="button"
                              onClick={(e) => handleQuickAdjustHours(task, -0.5, e)}
                              title="Decrease estimate 30 mins"
                              aria-label={`Decrease estimate for ${task.title} by 30 minutes`}
                              className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-900 rounded hover:bg-white cursor-pointer select-none"
                            >
                              -
                            </button>
                            <span className="px-1.5 text-slate-800 min-w-[32px] text-center">
                              ~{hours}h
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleQuickAdjustHours(task, 0.5, e)}
                              title="Increase estimate 30 mins"
                              aria-label={`Increase estimate for ${task.title} by 30 minutes`}
                              className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-900 rounded hover:bg-white cursor-pointer select-none"
                            >
                              +
                            </button>
                          </div>

                          <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Course Workload Breakdown & Pro Tips */}
        <div className="space-y-4">
          {/* Course Hours Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Layers size={16} className="text-blue-600" />
              <span>{isLaterSelected ? 'Later Work By Course' : `${selectedWeek.weekLabel} By Course`}</span>
            </h3>

            {displayedCourseList.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">No coursework in this period.</p>
            ) : (
              <div className="space-y-3">
                {displayedCourseList.map(c => {
                  const totalH = isLaterSelected ? laterHours : selectedWeek.totalHours;
                  const percent = totalH > 0 
                    ? Math.round((c.hours / totalH) * 100) 
                    : 0;

                  return (
                    <div key={c.course} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">{c.course}</span>
                        <span className="font-semibold text-slate-600">{c.hours}h ({percent}%)</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          style={{ width: `${percent}%` }}
                          className="h-full bg-blue-600 rounded-full"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* WHAT TO DO ABOUT IT */}
          <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl border border-indigo-200/70 p-4 text-indigo-950 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-indigo-900">
              <Sparkles size={14} className="text-indigo-600" />
              <span>WHAT TO DO ABOUT IT</span>
            </h4>
            <p className="text-xs text-indigo-900 leading-relaxed">
              {studyAdvice}
            </p>
          </div>
        </div>
      </div>

      {/* Edit Task Modal when clicked */}
      {selectedTaskForEdit && (
        <EditTaskModal
          task={selectedTaskForEdit}
          isOpen={!!selectedTaskForEdit}
          onClose={() => setSelectedTaskForEdit(null)}
        />
      )}
    </div>
  );
}
