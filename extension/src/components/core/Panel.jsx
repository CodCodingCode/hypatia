import { useEffect } from 'preact/hooks';
import { closeHypatia } from '../../hooks/useNavigation';
import { IconButton } from '../ui/Button';

/**
 * Main panel container - positioned within Gmail's content area
 * NOT a full-screen overlay - it replaces Gmail's email view
 */
export function Panel({ children }) {
  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeHypatia();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div class="hypatia-panel">
      <CloseButton />
      <div class="hypatia-panel__content">
        {children}
      </div>
    </div>
  );
}

function CloseButton() {
  return (
    <IconButton
      label="Close"
      onClick={closeHypatia}
      className="hypatia-panel__close"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </IconButton>
  );
}
