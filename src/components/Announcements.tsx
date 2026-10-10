import { useState } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { getCourseColor, safeGetTime, formatReadableDate, isTaskAnnouncement, sanitizeCanvasUrl, getUrlHostname } from '../utils';
import { ExternalLink, Megaphone, Edit3, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { Task } from '../types';
import EditTaskModal from './EditTaskModal';

export default function Announcements() {
  const { tasks, updateTask, deleteTask } = useTasksContext();
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const announcements = tasks
    .filter(isTaskAnnouncement)
    .sort((a, b) => safeGetTime(b.last_email_at || b.due_at, 0) - safeGetTime(a.last_email_at || a.due_at, 0));

  const handleToggleRead = async (item: Task) => {
    const isRead = item.status === 'Read';
    await updateTask(item.task_id, { status: isRead ? 'Todo' : 'Read' });
  };

  const handleDelete = async (item: Task) => {
    if (window.confirm(`Delete announcement "${item.title}"?`)) {
      await deleteTask(item.task_id);
    }
  };

  return (
    <div className="space-y-4">
      {announcements.map(item => {
        const isRead = item.status === 'Read';
        return (
          <div
            key={item.task_id}
            className={`bg-white rounded-2xl border p-5 shadow-sm flex flex-col md:flex-row gap-4 md:items-center transition-all ${
              isRead ? 'border-slate-200 opacity-75' : 'border-blue-200/80 ring-1 ring-blue-100'
            }`}
          >
            <div className={`p-3 rounded-xl shrink-0 self-start md:self-center ${isRead ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>
              <Megaphone size={24} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getCourseColor(item.course)}`}>
                  {item.course}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {formatReadableDate(item.last_email_at || item.due_at || '')}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isRead ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-800'
                }`}>
                  {isRead ? 'Read' : 'New'}
                </span>
              </div>
              <h4 className={`font-bold text-lg ${isRead ? 'text-slate-700' : 'text-slate-900'}`}>{item.title}</h4>
              <p className="text-slate-600 text-sm mt-1 whitespace-pre-line">{item.summary}</p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-center shrink-0">
              {/* Toggle Read */}
              <button
                type="button"
                onClick={() => handleToggleRead(item)}
                title={isRead ? 'Mark as unread' : 'Mark as read'}
                aria-label={isRead ? `Mark ${item.title} as unread` : `Mark ${item.title} as read`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  isRead
                    ? 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                }`}
              >
                {isRead ? <Circle size={14} /> : <CheckCircle2 size={14} />}
                <span>{isRead ? 'Mark Unread' : 'Mark Read'}</span>
              </button>

              {/* Edit */}
              <button
                type="button"
                onClick={() => setEditingTask(item)}
                title="Edit announcement"
                aria-label={`Edit ${item.title}`}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors cursor-pointer"
              >
                <Edit3 size={15} />
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => handleDelete(item)}
                title="Delete announcement"
                aria-label={`Delete ${item.title}`}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl border border-slate-200 hover:border-red-200 transition-colors cursor-pointer"
              >
                <Trash2 size={15} />
              </button>

              {/* Canvas External Link */}
              {sanitizeCanvasUrl(item.canvas_url) && (
                <a
                  href={sanitizeCanvasUrl(item.canvas_url)}
                  title={`Open ${getUrlHostname(item.canvas_url)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View announcement for ${item.title}`}
                  className="flex items-center justify-center bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-200 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors gap-1.5"
                >
                  <span>View</span> <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        );
      })}

      {announcements.length === 0 && (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-dashed border-slate-300 space-y-2">
          <p className="font-semibold text-slate-800 text-base">No Announcements Found</p>
          <p className="text-slate-500 text-xs max-w-sm mx-auto">
            When you have course notes or an announcement to keep, paste them in <strong>Smart Import &rarr; Paste course details</strong> to track updates here.
          </p>
        </div>
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          isOpen={Boolean(editingTask)}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
