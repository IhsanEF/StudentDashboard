import React, { useEffect } from 'react';
import { useToast } from '../hooks/useToast';

export function ToastHost() {
  const { toast, dismissToast } = useToast();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && toast) {
        dismissToast();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <aside
      aria-label="Action notification"
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] sm:max-w-md w-auto pointer-events-none transition-all duration-200"
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center justify-between gap-3.5 px-4 py-3 bg-slate-900/95 dark:bg-slate-800/95 text-white rounded-xl shadow-2xl border border-slate-700/80 text-sm font-medium backdrop-blur-xs"
      >
        <span className="truncate">{toast.message}</span>
        {toast.undo && (
          <button
            type="button"
            onClick={() => {
              toast.undo?.();
              dismissToast();
            }}
            className="shrink-0 px-3 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-900 cursor-pointer shadow-xs"
          >
            Undo
          </button>
        )}
      </div>
    </aside>
  );
}
