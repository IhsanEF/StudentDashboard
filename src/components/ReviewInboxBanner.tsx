import React, { useState } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import ReviewInboxModal from './ReviewInboxModal';
import { Task } from '../types';

export default function ReviewInboxBanner({ onEditTask }: { onEditTask?: (task: Task) => void }) {
  const { tasks, isDemoMode } = useTasksContext();
  const [modalOpen, setModalOpen] = useState(false);

  if (isDemoMode) return null;

  const itemsNeedingReview = tasks.filter(t => !t.demo_seed && (t.needs_review || !!t.canvas_date_diff));
  const totalCount = itemsNeedingReview.length;

  if (totalCount === 0) return null;

  return (
    <>
      <aside aria-label="Review Inbox" className="bg-amber-50 border border-amber-200/90 rounded-xl p-4 flex items-center justify-between text-amber-900 shadow-xs">
        <div>
          <h3 className="text-sm font-bold text-amber-900">
            Review Inbox ({totalCount})
          </h3>
          <p className="text-xs text-amber-800/80">
            {totalCount === 1 ? '1 imported task is waiting for your confirmation' : `${totalCount} imported tasks waiting for your confirmation`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-xs cursor-pointer"
        >
          Check
        </button>
      </aside>

      <ReviewInboxModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onEditTask={onEditTask}
      />
    </>
  );
}
