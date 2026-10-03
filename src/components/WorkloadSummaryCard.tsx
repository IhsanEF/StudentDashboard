import React from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { computeWeeklyWorkload } from '../services/workloadService';
import { Flame, Clock, Calendar, ArrowRight, CheckCircle2, TrendingUp } from 'lucide-react';
import { TabType } from '../types';
import { pluralize } from '../utils';

export default function WorkloadSummaryCard({ onNavigate }: { onNavigate?: (tab: TabType) => void }) {
  const { tasks, notificationPrefs } = useTasksContext();
  const thresholdHours = notificationPrefs?.workloadThresholdHours || 15;
  const workload = computeWeeklyWorkload(tasks, thresholdHours, 4);

  const nextWeek = workload.weeks[1];
  const thisWeek = workload.weeks[0];
  const nextWeekIntensity = nextWeek?.intensity || 'light';
  const thisWeekIntensity = thisWeek?.intensity || 'light';
  const nextWeekEmpty = !nextWeek?.taskCount;
  const thisWeekEmpty = !thisWeek?.taskCount;
  const intensityLabels = { light: 'Light', moderate: 'Moderate', heavy: 'Crunch' };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs transition-all hover:border-blue-300">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <Clock size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{nextWeekEmpty ? 'Next week: Nothing scheduled' : `Next week: ${workload.nextWeekHours} h of work — ${intensityLabels[nextWeekIntensity]}`}</h3>
          </div>
        </div>

        <button
          onClick={() => onNavigate && onNavigate('Workload')}
          className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>See the week</span>
          <ArrowRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {/* Next Week Block */}
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('Workload')}
          className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all hover:shadow-sm ${
            nextWeekIntensity === 'heavy' 
              ? 'bg-rose-50/70 border-rose-200 text-rose-950 hover:bg-rose-100/80 hover:border-rose-300' 
              : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-white hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Next Week</span>
            {nextWeekEmpty ? (
              <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                Nothing scheduled
              </span>
            ) : nextWeekIntensity === 'heavy' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-rose-500 text-white">
                <Flame size={10} /> Crunch
              </span>
            ) : nextWeekIntensity === 'moderate' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800">
                Moderate
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                <CheckCircle2 size={10} /> Light
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{workload.nextWeekHours}h</span>
            <span className="text-xs text-slate-500 font-medium">({nextWeek?.taskCount || 0} {pluralize(nextWeek?.taskCount || 0, 'task')})</span>
          </div>
          {nextWeekEmpty && <p className="text-xs text-slate-600 mt-2">No deadlines imported for this week yet — import a syllabus to see your real load.</p>}
          <p className="text-[11px] text-slate-500 mt-1 truncate flex items-center justify-between">
            <span>{nextWeek?.dateRangeFormatted}</span>
            <ArrowRight size={12} className="text-slate-400" />
          </p>
        </button>

        {/* This Week Block */}
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('Workload')}
          className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-left cursor-pointer transition-all hover:bg-white hover:border-blue-300 hover:shadow-sm"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">This Week</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
              thisWeekEmpty
                ? 'bg-slate-100 text-slate-600'
                : thisWeekIntensity === 'heavy'
                ? 'bg-rose-100 text-rose-800'
                : thisWeekIntensity === 'moderate'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-emerald-100 text-emerald-800'
            }`}>
              {thisWeekEmpty ? 'Nothing scheduled' : thisWeekIntensity === 'heavy' ? 'Crunch' : thisWeekIntensity === 'moderate' ? 'Moderate' : 'Light'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{thisWeek?.totalHours || 0}h</span>
            <span className="text-xs text-slate-500 font-medium">({thisWeek?.taskCount || 0} {pluralize(thisWeek?.taskCount || 0, 'task')})</span>
          </div>
          {thisWeekEmpty && <p className="text-xs text-slate-600 mt-2">No deadlines imported for this week yet — import a syllabus to see your real load.</p>}
          <p className="text-[11px] text-slate-500 mt-1 truncate flex items-center justify-between">
            <span>{thisWeek?.dateRangeFormatted}</span>
            <ArrowRight size={12} className="text-slate-400" />
          </p>
        </button>
      </div>
    </div>
  );
}
