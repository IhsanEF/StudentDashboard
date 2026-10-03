import React, { useEffect, useRef } from 'react';

export default function InlineDeleteConfirm({ message, onConfirm, onCancel, busy = false, inMenu = false }: {
  message: React.ReactNode;
  onConfirm: (event: React.MouseEvent) => void;
  onCancel: (event: React.MouseEvent | React.KeyboardEvent) => void;
  busy?: boolean;
  inMenu?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  return (
    <div className="p-2 space-y-2 text-xs" role={inMenu ? 'none' : 'group'} aria-label={inMenu ? undefined : 'Confirm deletion'}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel(event);
        }
      }}>
      <p className="font-medium text-gray-800 px-1">{message}</p>
      <div className="flex items-center gap-2 px-1">
        <button type="button" role={inMenu ? 'menuitem' : undefined} data-action="confirm-delete" disabled={busy}
          onClick={onConfirm}
          className="min-h-10 min-w-10 px-2.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50">
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button ref={cancelRef} type="button" role={inMenu ? 'menuitem' : undefined} data-action="cancel-delete" disabled={busy}
          onClick={onCancel}
          className="min-h-10 min-w-10 px-2.5 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400">
          Cancel
        </button>
      </div>
    </div>
  );
}
