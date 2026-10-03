import React, { useState, useEffect } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { Task } from '../types';
import TaskCard from './TaskCard';
import AddTaskModal from './AddTaskModal';
import { Search, Filter, Plus } from 'lucide-react';
import { getTaskUrgencyCategory, isTaskAnnouncement, isActiveAcademicTask, isActionableTask, isTaskSnoozed } from '../utils';

interface TasksListProps {
  initialGroup?: string;
}

export default function TasksList({ initialGroup }: TasksListProps = {}) {
  const { tasks, now, openImport, setFocusModeActive } = useTasksContext();
  const [search, setSearch] = useState('');
  const [filterCourse, setFilterCourse] = useState('All');
  const [filterBucket, setFilterBucket] = useState<string | null>(initialGroup || null);
  const [isAddOpen, setIsAddOpen] = useState(false);

  const activeTasks = tasks.filter(t => !isTaskAnnouncement(t));
  const courses = ['All', ...Array.from(new Set(activeTasks.map(t => t.course)))].filter(Boolean);

  const filteredTasks = activeTasks.filter(t => {
    const matchesSearch = (t.title || '').toLowerCase().includes(search.toLowerCase()) || 
                          (t.course || '').toLowerCase().includes(search.toLowerCase());
    const matchesCourse = filterCourse === 'All' || t.course === filterCourse;
    return matchesSearch && matchesCourse;
  });

  // Group by actionable tasks vs snoozed vs completed so snoozed tasks render inside Later with "Hidden until …" chip
  const academicTasks = filteredTasks.filter(isActiveAcademicTask);
  const actionableTasks = academicTasks.filter(isActionableTask);
  const snoozedTasks = academicTasks.filter(t => t.status !== 'Done' && t.status !== 'Submitted' && isTaskSnoozed(t));

  const grouped: Record<string, Task[]> = {
    'Past due': actionableTasks.filter(t => getTaskUrgencyCategory(t, now) === 'overdue'),
    'Due today': actionableTasks.filter(t => getTaskUrgencyCategory(t, now) === 'today'),
    'Next 7 days': actionableTasks.filter(t => getTaskUrgencyCategory(t, now) === 'upcoming'),
    Later: [
      ...actionableTasks.filter(t => getTaskUrgencyCategory(t, now) === 'later'),
      ...snoozedTasks
    ],
    'No date': actionableTasks.filter(t => getTaskUrgencyCategory(t, now) === 'nodate')
  };

  const pastClasses = filteredTasks.filter(t => t.status !== 'Done' && t.status !== 'Submitted' && getTaskUrgencyCategory(t, now) === 'past_schedule');

  const completedTasks = academicTasks.filter(t => t.status === 'Done' || t.status === 'Submitted');

  const getGroupId = (name: string) => `task-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  // Scroll to initialGroup if specified (e.g. from Overview tiles)
  useEffect(() => {
    if (!initialGroup) return;

    const timer = setTimeout(() => {
      let targetEl: HTMLElement | null = null;
      const lower = initialGroup.toLowerCase().trim();

      if (lower === 'done' || lower === 'submitted' || lower === 'completed') {
        const detailsEl = document.getElementById('task-group-completed') as HTMLDetailsElement | null;
        if (detailsEl) {
          detailsEl.open = true;
          targetEl = detailsEl;
        }
      } else if (lower === 'working') {
        targetEl = (document.querySelector('[data-task-status="Working"]') as HTMLElement) ||
                   document.getElementById('task-group-due-today') ||
                   document.getElementById('task-group-next-7-days');
      } else if (lower === 'past due' || lower === 'overdue') {
        targetEl = document.getElementById('task-group-past-due');
      } else if (lower === 'due today' || lower === 'today') {
        targetEl = document.getElementById('task-group-due-today');
      } else if (lower === 'next 7 days' || lower === 'upcoming') {
        targetEl = document.getElementById('task-group-next-7-days');
      } else if (lower === 'later') {
        targetEl = document.getElementById('task-group-later');
      } else if (lower === 'no date' || lower === 'nodate') {
        targetEl = document.getElementById('task-group-no-date');
      } else {
        const id = `task-group-${lower.replace(/[^a-z0-9]+/g, '-')}`;
        targetEl = document.getElementById(id);
      }

      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [initialGroup]);

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <h2 className="font-bold text-slate-900">Bring in your coursework</h2>
        <p className="text-sm text-slate-600 mt-1">Canvas won't let other apps sign in for you — so paste a Canvas email, upload a syllabus, or snap a screenshot and we'll pull the deadlines out.</p>
        <button type="button" onClick={() => openImport('calendar')} className="mt-3 text-sm font-semibold text-blue-700 hover:underline cursor-pointer">Import coursework</button>
      </div>
      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative w-full sm:w-72 shrink-0">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            aria-label="Search tasks by title or course"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-[130px]">
            <Filter size={18} className="text-slate-500 shrink-0" />
            <select
              aria-label="Filter tasks by course"
              value={filterCourse}
              onChange={(e) => setFilterCourse(e.target.value)}
              className="w-full sm:w-44 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer min-h-[44px]"
            >
              {courses.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          
          <button
            type="button"
            onClick={() => setFocusModeActive(true)}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer shadow-2xs min-h-[44px]"
            title="Focus on one task"
          >
            <span>Focus on one task</span>
          </button>

          <button
            onClick={() => setIsAddOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer shadow-xs min-h-[44px]"
          >
            <Plus size={16} /> <span>Add Task</span>
          </button>
        </div>
      </div>

      {/* Active filter banner if filtered by bucket */}
      {filterBucket && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-blue-900">
          <span>Filtering tasks by <strong>{filterBucket}</strong></span>
          <button
            type="button"
            onClick={() => setFilterBucket(null)}
            className="text-blue-700 hover:text-blue-900 font-semibold underline cursor-pointer"
          >
            Show all tasks
          </button>
        </div>
      )}

      {/* Task Groups */}
      <div className="space-y-10">
        {Object.entries(
          filterBucket
            ? Object.fromEntries(
                Object.entries(grouped).filter(([name]) => name.toLowerCase() === filterBucket.toLowerCase())
              )
            : grouped
        ).map(([groupName, groupTasks]) => {
          if (groupTasks.length === 0) return null;
          return (
            <section key={groupName} id={getGroupId(groupName)}>
              <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span>{groupName}</span>
                <span className="text-xs font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                  {groupTasks.length}
                </span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {groupTasks.map((task) => (
                  <TaskCard key={task.task_id} task={task} />
                ))}
              </div>
            </section>
          );
        })}

        {pastClasses.length > 0 && !filterBucket && (
          <details id="task-group-past-classes" className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5">
            <summary className="text-sm font-bold text-slate-600 cursor-pointer">Past classes ({pastClasses.length})</summary>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-4">
              {pastClasses.map(task => <TaskCard key={task.task_id} task={task} />)}
            </div>
          </details>
        )}

        {/* Completed (n) as a collapsed <details> */}
        {completedTasks.length > 0 && (
          <details
            id="task-group-completed"
            className="group bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 transition-all"
          >
            <summary className="text-sm font-bold text-slate-600 uppercase tracking-wider cursor-pointer flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <span>Completed</span>
                <span className="text-xs font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                  {completedTasks.length}
                </span>
              </div>
              <span className="text-xs font-semibold text-slate-400 group-open:hidden">Show</span>
              <span className="text-xs font-semibold text-slate-400 hidden group-open:inline">Hide</span>
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-4">
              {completedTasks.map((task) => (
                <TaskCard key={task.task_id} task={task} />
              ))}
            </div>
          </details>
        )}

        {filteredTasks.length === 0 && (
          <div className="text-center py-20 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300 p-6 flex flex-col items-center justify-center gap-3">
            <p>
              {tasks.length === 0
                ? 'Nothing here yet. Paste your Canvas calendar link (Smart Import) to bring in every due date, or add a task by hand.'
                : 'No tasks match your filters.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer shadow-xs"
              >
                Add Task
              </button>
              <button
                type="button"
                onClick={() => openImport('calendar')}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer border border-slate-200"
              >
                Import from Canvas calendar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Task Modal */}
      <AddTaskModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        defaultCourse={filterCourse !== 'All' ? filterCourse : (courses.find(c => c !== 'All') || '')}
      />
    </div>
  );
}
