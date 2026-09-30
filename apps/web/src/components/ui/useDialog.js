import { useEffect, useRef } from 'react';

/**
 * Drives a native <dialog> as a modal from an `open` prop.
 * Native modal dialogs trap focus, make the page inert and restore focus on close.
 * Escape and backdrop clicks call onClose (unless `dismissible` is false, e.g. while saving).
 */
export function useDialog({ open, onClose, dismissible = true }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return undefined;

    // Lock page scroll while the dialog is open.
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  return {
    ref,
    // Handle Escape on keydown: preventing it here stops the browser's own close request,
    // which (unlike the `cancel` event) can always be prevented.
    onKeyDown(event) {
      // Skip if a child (e.g. an open dropdown menu) already handled this Escape.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (dismissible) onClose?.();
    },
    // Fallback if the browser still sends a close request.
    onCancel(event) {
      event.preventDefault();
      if (dismissible) onClose?.();
    },
    // If the browser closed the dialog anyway, keep React state in sync.
    onClose() {
      if (open) onClose?.();
    },
    // A click whose target is the <dialog> itself landed on the backdrop.
    onClick(event) {
      if (event.target === event.currentTarget && dismissible) onClose?.();
    },
  };
}
