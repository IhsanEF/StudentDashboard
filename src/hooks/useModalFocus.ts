import React, { useEffect, useRef } from 'react';

export interface UseModalFocusOptions {
  isOpen?: boolean;
  onClose: () => void;
  trapFocus?: boolean;
  closeOnEscape?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

interface ModalStackEntry {
  id: string;
  close: () => void;
  element: () => HTMLElement | null;
}

// Module-level stack for managing nested modals and top-most Escape priority (V3-100)
const modalStack: ModalStackEntry[] = [];
let nextModalId = 0;

// Hide only branches outside the top dialog: dialogs can be rendered inside <main>.
// Hiding their ancestor app root would hide/inert the dialog itself as well.
const isolatedBranches = new Map<Element, { ariaHidden: string | null; inert: string | null }>();
let backgroundObserver: MutationObserver | null = null;

function restoreBackground() {
  for (const [element, previous] of isolatedBranches) {
    for (const [attribute, value] of [['aria-hidden', previous.ariaHidden], ['inert', previous.inert]] as const) {
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    }
  }
  isolatedBranches.clear();
}

function isolateBackground() {
  restoreBackground();
  let branch: Element | null = modalStack.at(-1)?.element() ?? null;
  while (branch?.parentElement && branch !== document.body) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch) continue;
      isolatedBranches.set(sibling, {
        ariaHidden: sibling.getAttribute('aria-hidden'), inert: sibling.getAttribute('inert')
      });
      sibling.setAttribute('aria-hidden', 'true');
      sibling.setAttribute('inert', '');
    }
    branch = branch.parentElement;
  }
}

// Module-level counter for body scroll locking across single and nested modals (V3-470)
let openModalCount = 0;
let originalBodyOverflow: string | null = null;

export function useModalFocus({ 
  isOpen = true, 
  onClose,
  trapFocus = true,
  closeOnEscape = true,
  initialFocusRef
}: UseModalFocusOptions) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const idRef = useRef<string>('');
  const trapFocusRef = useRef(trapFocus);
  const closeOnEscapeRef = useRef(closeOnEscape);
  
  trapFocusRef.current = trapFocus;
  closeOnEscapeRef.current = closeOnEscape;

  if (!idRef.current) {
    nextModalId += 1;
    idRef.current = `modal_${nextModalId}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // Keep latest onClose in a ref to avoid re-triggering focus effects on every parent re-render (V3-159, V3-376)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Main modal effect: keyed ONLY on [isOpen] (V3-101, V3-159, V3-470)
  useEffect(() => {
    if (!isOpen) return;

    const modalId = idRef.current;
    if (typeof document !== 'undefined') {
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Lock body scroll to prevent page dragging/scrolling behind modal (V3-470)
      openModalCount += 1;
      if (openModalCount === 1 && document.body) {
        originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
    }

    // Push this modal onto the modal stack
    modalStack.push({
      id: modalId,
      close: () => onCloseRef.current(),
      element: () => modalRef.current
    });

    // Move focus off the background before hiding it from assistive technology.
    modalRef.current?.focus?.();
    isolateBackground();
    if (!backgroundObserver && typeof MutationObserver !== 'undefined') {
      backgroundObserver = new MutationObserver(isolateBackground);
      backgroundObserver.observe(document.body, { childList: true, subtree: true });
    }

    // 50ms initial focus timer - prefers autofocus or first form input, NEVER close button (V3-101, V3-159)
    const timer = setTimeout(() => {
      const modal = modalRef.current;
      if (!modal || modalStack.at(-1)?.id !== modalId) return;

      // If user already clicked or typed into a field inside the modal, do not yank focus away
      if (modal.contains(document.activeElement) && document.activeElement !== modal) {
        return;
      }

      // 1. Explicit initial focus ref
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }

      // 2. Element explicitly marked with autofocus or data-autofocus
      const autoFocusEl = modal.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      if (autoFocusEl) {
        autoFocusEl.focus();
        return;
      }

      // 3. First interactive form control (input, textarea, select), skipping hidden/disabled
      const firstFormControl = modal.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"])'
      );
      if (firstFormControl) {
        firstFormControl.focus();
        return;
      }

      // 4. Focusable elements, skipping Close (X) buttons with aria-label/title like 'Close'
      const allFocusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

      const nonCloseElements = allFocusable.filter(el => {
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        const isClose = ariaLabel.includes('close') || title.includes('close') || text === '×' || text === '✕';
        return !isClose;
      });

      if (nonCloseElements.length > 0) {
        nonCloseElements[0].focus();
      } else if (allFocusable.length > 0) {
        allFocusable[0].focus();
      } else {
        modal.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the top-most modal in modalStack handles Escape (V3-100)
      if (closeOnEscapeRef.current && e.key === 'Escape') {
        const isTopModal = modalStack.length > 0 && modalStack[modalStack.length - 1].id === modalId;
        if (!isTopModal) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      // Trap focus within the top-most modal (V4-227)
      if (trapFocusRef.current && e.key === 'Tab' && modalRef.current) {
        const isTopModal = modalStack.length > 0 && modalStack[modalStack.length - 1].id === modalId;
        if (!isTopModal) return;

        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    // Use capture phase to intercept Escape before child or window sibling handlers
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);

      // Restore body scroll when all modals have closed (V3-470)
      if (typeof document !== 'undefined') {
        openModalCount = Math.max(0, openModalCount - 1);
        if (openModalCount === 0 && document.body) {
          document.body.style.overflow = originalBodyOverflow !== null ? originalBodyOverflow : '';
          originalBodyOverflow = null;
        }
      }

      // Remove this modal from modalStack
      const idx = modalStack.findIndex(m => m.id === modalId);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }

      isolateBackground();
      if (modalStack.length === 0) {
        backgroundObserver?.disconnect();
        backgroundObserver = null;
      }

      // Restore focus strictly upon closing / unmounting
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCloseRef.current();
    }
  };

  return { modalRef, handleBackdropClick };
}

// Reusable Modal wrapper component for standardized dialog accessibility (V4-227)
export interface ModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  overlayClassName = ''
}: ModalWrapperProps) {
  const { modalRef, handleBackdropClick } = useModalFocus({ isOpen, onClose });

  if (!isOpen) return null;

  return React.createElement(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title || 'Modal',
      onClick: handleBackdropClick,
      className: `fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 ${overlayClassName}`
    },
    React.createElement(
      'div',
      {
        ref: modalRef,
        tabIndex: -1,
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        className: `bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden outline-none ${className}`
      },
      children
    )
  );
}
