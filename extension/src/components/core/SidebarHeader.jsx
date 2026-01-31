import { IconButton } from '../ui/Button';

/**
 * Sidebar header with logo and close button
 */
export function SidebarHeader({ onClose }) {
  return (
    <div class="hypatia-sidebar__header">
      <div class="hypatia-sidebar__logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="hypatia-sidebar__title">Hypatia</span>
      </div>
      <IconButton
        label="Close sidebar"
        onClick={onClose}
        className="hypatia-sidebar__close"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </IconButton>
    </div>
  );
}
