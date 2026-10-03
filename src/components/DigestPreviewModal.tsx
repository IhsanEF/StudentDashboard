import React, { useState } from 'react';
import { Task } from '../types';
import { generateDigestPreview } from '../services/notificationService';
import { useModalFocus } from '../hooks/useModalFocus';
import { X, Sparkles, Calendar, Clock, CheckCircle2, Send, ExternalLink } from 'lucide-react';
import { formatInTimeZone, TIMEZONE, parseLocalDate, isDateOnly } from '../utils';

interface DigestPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  onTriggerTestDigest?: (type: 'daily' | 'weekly') => void;
}

export default function DigestPreviewModal({
  isOpen,
  onClose,
  tasks,
  onTriggerTestDigest
}: DigestPreviewModalProps) {
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });
  const [digestType, setDigestType] = useState<'daily' | 'weekly'>('daily');
  const [sentNotice, setSentNotice] = useState(false);

  if (!isOpen) return null;

  const preview = generateDigestPreview(digestType, tasks);

  const handleSendTest = () => {
    if (onTriggerTestDigest) {
      onTriggerTestDigest(digestType);
      setSentNotice(true);
      setTimeout(() => setSentNotice(false), 3000);
    }
  };

  return (
    <div
      id="digest-preview-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        id="digest-preview-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="digest-preview-title"
        tabIndex={-1}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl">
              {digestType === 'daily' ? <Sparkles className="w-5 h-5" /> : <Calendar className="w-5 h-5" />}
            </div>
            <div>
              <h2 id="digest-preview-title" className="text-base font-bold text-slate-900 dark:text-white">
                Preview of your daily summary
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Summary of tasks and deadlines generated in Vancouver time
              </p>
            </div>
          </div>
          <button
            id="close-digest-modal-btn"
            type="button"
            aria-label="Close digest preview"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Digest Type Switcher */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-2">
          <button
            id="digest-tab-daily-btn"
            aria-pressed={digestType === 'daily'}
            onClick={() => setDigestType('daily')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
              digestType === 'daily'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Daily Morning "Due Today" (8:00 AM)
          </button>
          <button
            id="digest-tab-weekly-btn"
            aria-pressed={digestType === 'weekly'}
            onClick={() => setDigestType('weekly')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
              digestType === 'weekly'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Sunday "Week Ahead" (6:00 PM)
          </button>
        </div>

        {/* Digest Content Preview */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-sm bg-slate-50/50 dark:bg-slate-950/40">
          {/* Summary Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                {preview.title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {preview.summaryText}
              </p>
            </div>

            {/* Task Items List */}
            {preview.tasks.length === 0 ? (
              <div className="py-6 px-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  All clear for this timeframe!
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  No active tasks scheduled in {preview.periodLabel}.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Tasks included ({preview.count})
                </span>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden">
                  {preview.tasks.map(task => {
                    let dueTimeFormatted = '';
                    try {
                      if (task.due_at) {
                        const d = parseLocalDate(task.due_at);
                        if (d) dueTimeFormatted = isDateOnly(task.due_at)
                          ? `${formatInTimeZone(d, TIMEZONE, 'EEEE, MMM d')} (end of day)`
                          : formatInTimeZone(d, TIMEZONE, 'EEE, MMM d • h:mm a');
                      }
                    } catch {
                      dueTimeFormatted = task.due_at;
                    }

                    return (
                      <div key={task.task_id} className="p-3 bg-white dark:bg-slate-900 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
                              {task.course || 'Course'}
                            </span>
                            <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                              {task.title}
                            </span>
                          </div>
                          {dueTimeFormatted && (
                            <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              <Clock className="w-3 h-3" />
                              <span>Due: {dueTimeFormatted} (Vancouver Time)</span>
                            </div>
                          )}
                        </div>
                        {task.status && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full shrink-0">
                            {task.status}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between">
          <div>
            {sentNotice && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Test summary added to your Notifications.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              id="test-dispatch-digest-btn"
              onClick={handleSendTest}
              className="px-3.5 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Send me a test now
            </button>
            <button
              id="close-digest-btn"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
