import { useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Button, IconButton } from './Button';

/**
 * Modal component with Gmail-native styling
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close handler
 * @param {string} props.title - Modal title
 * @param {string} props.size - Modal size ('sm' | 'md' | 'lg')
 * @param {boolean} props.showCloseButton - Show close button in header
 * @param {preact.ComponentChildren} props.children - Modal content
 * @param {preact.ComponentChildren} props.footer - Modal footer content
 */
export function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  showCloseButton = true,
  children,
  footer
}) {
  const modalRef = useRef(null);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Handle click outside
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  // Focus trap
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeStyles = {
    sm: { width: '400px' },
    md: { width: '500px' },
    lg: { width: '700px' }
  };

  const modalContent = (
    <div
      class={`hypatia-modal-backdrop ${isOpen ? 'hypatia-modal-backdrop--visible' : ''}`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        ref={modalRef}
        class="hypatia-modal"
        style={sizeStyles[size]}
      >
        {title && (
          <div class="hypatia-modal__header">
            <h2 id="modal-title" class="hypatia-modal__title">{title}</h2>
            {showCloseButton && (
              <IconButton
                label="Close"
                onClick={onClose}
                className="hypatia-modal__close"
              >
                <CloseIcon />
              </IconButton>
            )}
          </div>
        )}

        <div class="hypatia-modal__body">
          {children}
        </div>

        {footer && (
          <div class="hypatia-modal__footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  // Get or create modal root
  let modalRoot = document.getElementById('hypatia-modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'hypatia-modal-root';
    modalRoot.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647;';
    document.body.appendChild(modalRoot);
  }

  return createPortal(modalContent, modalRoot);
}

/**
 * Confirmation modal
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary'
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p class="hypatia-text-secondary">{message}</p>
    </Modal>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
