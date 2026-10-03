import React, { useState, useEffect } from 'react';
import { Task, SubTask } from '../types';
import { useTasksContext } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { toVancouverISO, formatInTimeZone, TIMEZONE, formatVancouverDate } from '../utils';
import { X, Send, ListTree, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import TaskBreakdownModal from './TaskBreakdownModal';

export function formatProgressNoteLine(line: string): string {
  if (!line || !line.trim()) return '';
  const match = line.match(/^\[(.*?)\]\s*(.*)$/);
  if (!match) return line;
  const [, rawDate, text] = match;
  try {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      const formattedDate = formatInTimeZone(d, TIMEZONE, 'MMM d, h:mm a');
      return `${formattedDate} — ${text}`;
    }
  } catch {
    // fallback to original line on parse error
  }
  return line;
}

export default function ProgressModal({ task, onClose }: { task: Task, onClose: () => void }) {
  const { tasks, updateTask, showToast } = useTasksContext();
  const currentTask = tasks.find(t => t.task_id === task.task_id) || task;

  const [note, setNote] = useState('');
  const [nextAction, setNextAction] = useState(currentTask.next_action || '');
  const [loading, setLoading] = useState(false);
  const [subtasksDirty, setSubtasksDirty] = useState(false);
  const [subtasks, setSubtasks] = useState<SubTask[]>(currentTask.subtasks || []);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);

  // Sync subtasks with latest task data unless user has dirty local toggle state (V3-094)
  useEffect(() => {
    if (!subtasksDirty) {
      setSubtasks(currentTask.subtasks || []);
    }
  }, [currentTask.subtasks, subtasksDirty]);

  const { modalRef, handleBackdropClick } = useModalFocus({
    isOpen: true,
    onClose
  });

  const handleToggleSubtask = (id: string) => {
    setSubtasksDirty(true);
    setSubtasks(prev => prev.map(st => st.id === id ? { ...st, done: !st.done } : st));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    let updatedNotes = currentTask.progress_notes || '';
    if (note.trim()) {
      const newNote = `[${toVancouverISO(new Date())}] ${note.trim()}`;
      updatedNotes = updatedNotes ? `${updatedNotes}\n${newNote}` : newNote;
    }

    const checkedMilestone = subtasksDirty && subtasks.some(st =>
      st.done && currentTask.subtasks?.some(latest => latest.id === st.id && !latest.done)
    );
    const promotesStatus = currentTask.status === 'Not Started' && Boolean(note.trim() || checkedMilestone);
    const updatedStatus = promotesStatus ? 'Working' : currentTask.status;

    const payload: Partial<Task> = {
      progress_notes: updatedNotes,
      next_action: nextAction,
      status: updatedStatus,
      last_interaction_at: new Date().toISOString()
    };

    // Only include subtasks if user actively toggled subtasks in this modal,
    // merging toggles onto the latest snapshot to avoid wiping out AI-generated plans (V3-094)
    if (subtasksDirty) {
      const latestSubtasks = currentTask.subtasks || [];
      const toggledMap = new Map(subtasks.map(s => [s.id, s.done]));
      payload.subtasks = latestSubtasks.map(s => 
        toggledMap.has(s.id) ? { ...s, done: toggledMap.get(s.id)! } : s
      );
    }

    try {
      await updateTask(currentTask.task_id, payload);
      if (promotesStatus) showToast({ message: 'Progress saved. Status changed from Not Started to Working.' });
      onClose();
    } catch (err) {
      console.error('Failed to save progress note:', err);
      if (showToast) {
        showToast({ message: 'Failed to save progress. Please try again.' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div 
        ref={modalRef}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      >
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
            <h3 id="progress-modal-title" className="font-bold text-slate-800">Add Progress: {currentTask.title}</h3>
            <button 
              onClick={onClose} 
              aria-label="Close dialog"
              className="text-slate-400 hover:text-slate-600 transition-colors p-1 bg-slate-200/50 hover:bg-slate-200 rounded-full cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Previous Progress Notes formatted with Vancouver timezone (V4-182) */}
            {currentTask.progress_notes && (
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Previous Notes
                </label>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-32 overflow-y-auto space-y-1.5 text-xs text-slate-700">
                  {currentTask.progress_notes.split('\n').filter(Boolean).map((line, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {formatProgressNoteLine(line)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="progress-note-input" className="block text-sm font-semibold text-slate-700 mb-2">New Progress Note</label>
              <textarea
                id="progress-note-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-shadow"
                rows={3}
                placeholder="What did you do just now?"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="next-action-input" className="block text-sm font-semibold text-slate-700 mb-2">Next Action</label>
              <input
                id="next-action-input"
                type="text"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-shadow"
                placeholder="What needs to be done next?"
              />
            </div>

            {/* Subtasks Checklist Section */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <ListTree size={14} className="text-indigo-600" />
                  <span>Steps ({subtasks.filter(s => s.done).length} of {subtasks.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setBreakdownModalOpen(true)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles size={12} />
                  <span>{subtasks.length > 0 ? 'Edit steps' : 'Plan the steps'}</span>
                </button>
              </div>

              {subtasks.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 max-h-36 overflow-y-auto space-y-1.5">
                  {subtasks.map(st => (
                    <div 
                      key={st.id}
                      onClick={() => handleToggleSubtask(st.id)}
                      className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer text-xs"
                    >
                      {st.done ? (
                        <CheckCircle2 size={15} className="text-emerald-600 fill-emerald-50 shrink-0" />
                      ) : (
                        <Circle size={15} className="text-slate-400 hover:text-blue-500 shrink-0" />
                      )}
                      <span className={`flex-1 min-w-0 font-medium line-clamp-1 ${st.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                        {st.title}
                      </span>
                      {st.doByDate && (
                        <span className="text-[10px] text-blue-600 font-semibold shrink-0">
                          {formatVancouverDate(st.doByDate)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="pt-2 flex justify-end gap-3">
              <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || (!note.trim() && nextAction === (currentTask.next_action || '') && !subtasksDirty)}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Send size={16} /> Save Progress
              </button>
            </div>
          </form>
        </div>
      </div>

      {breakdownModalOpen && (
        <TaskBreakdownModal
          task={currentTask}
          isOpen={breakdownModalOpen}
          onClose={() => setBreakdownModalOpen(false)}
        />
      )}
    </>
  );
}
