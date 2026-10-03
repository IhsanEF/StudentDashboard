import React, { useState, useRef, useEffect, useContext } from 'react';
import InlineDeleteConfirm from './InlineDeleteConfirm';
import { Task } from '../types';
import { TaskContext } from '../hooks/useTasks';
import { cn, sanitizeCanvasUrl, getUrlHostname, isTrustedCanvasHost } from '../utils';
import { addDays } from 'date-fns';
import {
  MoreVertical,
  Edit3,
  CheckCircle2,
  Moon,
  MessageSquarePlus,
  ListTree,
  ExternalLink,
  Trash2
} from 'lucide-react';

export interface CardMenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  onClick: () => void;
  variant?: 'default' | 'danger';
}

export interface CardMenuProps {
  task: Task;
  onEdit?: () => void;
  onMarkSubmitted?: () => void;
  onHideUntilTomorrow?: () => void;
  onAddNote?: () => void;
  onBreakIntoSteps?: () => void;
  onOpenCanvas?: () => void;
  onDelete?: () => void;
  className?: string;
}

/**
 * Computes the gated menu items based on task status, type, canvas URL, and subtasks.
 */
export function getCardMenuItems(
  task: Task,
  callbacks: {
    onEdit?: () => void;
    onMarkSubmitted?: () => void;
    onHideUntilTomorrow?: () => void;
    onAddNote?: () => void;
    onBreakIntoSteps?: () => void;
    onOpenCanvas?: () => void;
    onDeleteClick: () => void;
  }
): CardMenuItem[] {
  const isDoneOrSubmitted = task.status === 'Done' || task.status === 'Submitted';

  // For Done or Submitted tasks the menu shows only Edit and Delete.
  if (isDoneOrSubmitted) {
    return [
      {
        key: 'edit',
        label: 'Edit',
        icon: Edit3,
        onClick: () => callbacks.onEdit?.(),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        onClick: callbacks.onDeleteClick,
        variant: 'danger',
      },
    ];
  }

  const items: CardMenuItem[] = [];

  // 1. Edit
  items.push({
    key: 'edit',
    label: 'Edit',
    icon: Edit3,
    onClick: () => callbacks.onEdit?.(),
  });

  // 2. Mark submitted
  items.push({
    key: 'mark-submitted',
    label: 'Mark submitted',
    icon: CheckCircle2,
    onClick: () => callbacks.onMarkSubmitted?.(),
  });

  // 3. Hide until tomorrow
  items.push({
    key: 'hide-tomorrow',
    label: 'Hide until tomorrow',
    icon: Moon,
    onClick: () => callbacks.onHideUntilTomorrow?.(),
  });

  // 4. Add note
  items.push({
    key: 'add-note',
    label: 'Add note',
    icon: MessageSquarePlus,
    onClick: () => callbacks.onAddNote?.(),
  });

  // 5. Break into steps (or "Edit steps" when steps exist; never for quiz or exam types)
  const normalizedType = (task.type || '').toLowerCase();
  const isQuizOrExam = normalizedType === 'quiz' || normalizedType === 'exam';
  if (!isQuizOrExam) {
    const hasExistingSteps = Array.isArray(task.subtasks) && task.subtasks.length > 0;
    items.push({
      key: 'steps',
      label: hasExistingSteps ? 'Edit steps' : 'Plan the steps',
      icon: ListTree,
      onClick: () => callbacks.onBreakIntoSteps?.(),
    });
  }

  // 6. Open in Canvas (only when sanitizeCanvasUrl(task.canvas_url) has a pathname longer than "/")
  const sanitizedCanvasUrl = sanitizeCanvasUrl(task.canvas_url);
  let hasValidCanvasPath = false;
  if (sanitizedCanvasUrl) {
    try {
      const parsed = new URL(sanitizedCanvasUrl);
      hasValidCanvasPath = parsed.pathname.length > 1; // longer than "/"
    } catch {
      hasValidCanvasPath = false;
    }
  }

  if (hasValidCanvasPath) {
    items.push({
      key: 'open-canvas',
      label: `${isTrustedCanvasHost(getUrlHostname(sanitizedCanvasUrl)) ? 'Open in Canvas' : 'Open external link'} · ${getUrlHostname(sanitizedCanvasUrl)}`,
      icon: ExternalLink,
      onClick: () => {
        if (callbacks.onOpenCanvas) {
          callbacks.onOpenCanvas();
        } else {
          window.open(sanitizedCanvasUrl, '_blank', 'noopener,noreferrer');
        }
      },
    });
  }

  // 7. Delete
  items.push({
    key: 'delete',
    label: 'Delete',
    icon: Trash2,
    onClick: callbacks.onDeleteClick,
    variant: 'danger',
  });

  return items;
}

export const CardMenu: React.FC<CardMenuProps> = ({
  task,
  onEdit,
  onMarkSubmitted,
  onHideUntilTomorrow,
  onAddNote,
  onBreakIntoSteps,
  onOpenCanvas,
  onDelete,
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const taskContext = useContext(TaskContext);

  // Close menu and return focus to trigger
  const closeMenu = () => {
    setIsOpen(false);
    setShowDeleteConfirm(false);
    triggerRef.current?.focus();
  };

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
        setShowDeleteConfirm(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  // Focus management when opening or switching to confirm
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        if (showDeleteConfirm) {
          const cancelButton = menuRef.current?.querySelector<HTMLElement>('[data-action="cancel-delete"]');
          cancelButton?.focus();
        } else {
          const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
          firstItem?.focus();
        }
      });
    }
  }, [isOpen, showDeleteConfirm]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (!nextOpen) {
      setShowDeleteConfirm(false);
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
      setShowDeleteConfirm(false);
      requestAnimationFrame(() => {
        const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        firstItem?.focus();
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
      setShowDeleteConfirm(false);
      requestAnimationFrame(() => {
        const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (items && items.length > 0) {
          items[items.length - 1]?.focus();
        }
      });
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }

    const menu = menuRef.current;
    if (!menu) return;

    const menuItems = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
    );
    if (menuItems.length === 0) return;

    const currentIndex = menuItems.findIndex((el) => el === document.activeElement);

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
      menuItems[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
      menuItems[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuItems[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      menuItems[menuItems.length - 1]?.focus();
    }
  };

  // Actions handling
  const handleEdit = () => {
    onEdit?.();
  };

  const handleMarkSubmitted = async () => {
    if (onMarkSubmitted) {
      onMarkSubmitted();
    } else if (taskContext?.updateTask) {
      await taskContext.updateTask(task.task_id, {
        status: 'Submitted',
        check_again_at: '',
        last_interaction_at: new Date().toISOString()
      });
    }
  };

  const handleHideUntilTomorrow = async () => {
    if (onHideUntilTomorrow) {
      onHideUntilTomorrow();
    } else if (taskContext?.updateTask) {
      await taskContext.updateTask(task.task_id, {
        check_again_at: addDays(new Date(), 1).toISOString(),
        last_interaction_at: new Date().toISOString()
      });
    }
  };

  const handleAddNote = () => {
    onAddNote?.();
  };

  const handleBreakIntoSteps = () => {
    onBreakIntoSteps?.();
  };

  const handleOpenCanvas = () => {
    if (onOpenCanvas) {
      onOpenCanvas();
    } else {
      const url = sanitizeCanvasUrl(task.canvas_url);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
    setIsOpen(false);
    if (onDelete) {
      onDelete();
    } else if (taskContext?.deleteTask) {
      await taskContext.deleteTask(task.task_id);
    }
    triggerRef.current?.focus();
  };

  const handleCancelDelete = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
    requestAnimationFrame(() => {
      const deleteItem = menuRef.current?.querySelector<HTMLElement>('[data-action="delete-item"]');
      if (deleteItem) {
        deleteItem.focus();
      } else {
        const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        firstItem?.focus();
      }
    });
  };

  const menuItems = getCardMenuItems(task, {
    onEdit: handleEdit,
    onMarkSubmitted: handleMarkSubmitted,
    onHideUntilTomorrow: handleHideUntilTomorrow,
    onAddNote: handleAddNote,
    onBreakIntoSteps: handleBreakIntoSteps,
    onOpenCanvas: handleOpenCanvas,
    onDeleteClick: handleDeleteClick,
  });

  return (
    <div className={cn('relative inline-block text-left', className)}>
      <button
        ref={triggerRef}
        id={`card-menu-trigger-${task.task_id}`}
        type="button"
        aria-label={'More actions for "' + task.title + '"'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `card-menu-${task.task_id}` : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="min-h-10 min-w-10 inline-flex items-center justify-center p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          id={`card-menu-${task.task_id}`}
          role="menu"
          aria-label={'Actions for ' + task.title}
          onKeyDown={handleMenuKeyDown}
          tabIndex={-1}
          className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 focus:outline-none"
        >
          {showDeleteConfirm ? (
            <InlineDeleteConfirm
              inMenu
              message="Delete this task?"
              onConfirm={handleConfirmDelete}
              onCancel={handleCancelDelete}
            />
          ) : (
            menuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-action={item.key === 'delete' ? 'delete-item' : undefined}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                  if (item.key !== 'delete') {
                    setIsOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
                className={cn(
                  'w-full min-h-10 flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors focus:outline-none focus:bg-gray-100',
                  item.variant === 'danger'
                    ? 'text-red-600 hover:bg-red-50 hover:text-red-700'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <item.icon
                  className={cn(
                    'w-4 h-4 shrink-0',
                    item.variant === 'danger' ? 'text-red-500' : 'text-gray-400'
                  )}
                />
                <span>{item.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default CardMenu;
