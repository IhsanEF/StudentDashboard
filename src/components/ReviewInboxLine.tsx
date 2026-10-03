import React, { useState } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import ReviewInboxModal from './ReviewInboxModal';
import { Task } from '../types';

export default function ReviewInboxLine({ onEditTask }: { onEditTask?: (task: Task) => void }) {
  const { tasks, isDemoMode } = useTasksContext();
  const [modalOpen, setModalOpen] = useState(false);

  if (isDemoMode) return null;

  const itemsNeedingReview = tasks.filter(t => !t.demo_seed && (t.needs_review || !!t.canvas_date_diff));
  const totalCount = itemsNeedingReview.length;

  if (totalCount === 0) return null;

  return (
    <>
      <div className="h-[44px] min-h-[44px] bg-amber-50 border border-amber-200/90 rounded-xl px-4 flex items-center justify-between text-amber-900 shadow-xs">
        <span className="text-xs sm:text-sm font-semibold tracking-tight">
          {totalCount} imported item{totalCount === 1 ? '' : 's'} to check →
        </span>
        <button
          onClick={() => setModalOpen(true)}
          className="px-3.5 py-1 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-xs cursor-pointer"
        >
          Check
        </button>
      </div>

      <ReviewInboxModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onEditTask={onEditTask}
      />
    </>
  );
}
