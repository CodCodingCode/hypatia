import { Button } from './Button';

/**
 * Empty state component for when there's no data
 *
 * @param {Object} props
 * @param {preact.ComponentChildren} props.icon - Icon to display
 * @param {string} props.title - Title text
 * @param {string} props.description - Description text
 * @param {string} props.actionText - Button text
 * @param {Function} props.onAction - Button click handler
 */
export function EmptyState({
  icon,
  title,
  description,
  actionText,
  onAction
}) {
  return (
    <div class="hypatia-empty-state">
      {icon && (
        <div class="hypatia-empty-state__icon">
          {icon}
        </div>
      )}
      {title && (
        <h3 class="hypatia-empty-state__title">{title}</h3>
      )}
      {description && (
        <p class="hypatia-empty-state__description">{description}</p>
      )}
      {actionText && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </div>
  );
}

/**
 * Common empty state icons
 */
export const EmptyIcons = {
  campaigns: (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="8" y="12" width="48" height="40" rx="4" />
      <path d="M8 24h48" />
      <path d="M20 36h24" />
      <path d="M20 44h16" />
    </svg>
  ),

  leads: (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="32" cy="20" r="12" />
      <path d="M12 56c0-11 9-20 20-20s20 9 20 20" />
    </svg>
  ),

  emails: (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="8" y="16" width="48" height="32" rx="4" />
      <path d="M8 20l24 16 24-16" />
    </svg>
  ),

  search: (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="28" cy="28" r="16" />
      <path d="M40 40l16 16" />
    </svg>
  )
};
