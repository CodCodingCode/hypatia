/**
 * Badge component for status indicators
 *
 * @param {Object} props
 * @param {'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'} props.variant
 * @param {string} props.className - Additional CSS classes
 * @param {preact.ComponentChildren} props.children - Badge content
 */
export function Badge({
  variant = 'default',
  className = '',
  children,
  ...props
}) {
  const classes = [
    'hypatia-badge',
    `hypatia-badge--${variant}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <span class={classes} {...props}>
      {children}
    </span>
  );
}

/**
 * Status badge with icon
 */
export function StatusBadge({ status, children }) {
  const statusConfig = {
    done: { variant: 'success', icon: '✓' },
    pending: { variant: 'warning', icon: '○' },
    error: { variant: 'error', icon: '!' },
    new: { variant: 'primary', icon: '★' },
    default: { variant: 'default', icon: '' }
  };

  const config = statusConfig[status] || statusConfig.default;

  return (
    <Badge variant={config.variant}>
      {config.icon && <span>{config.icon}</span>}
      {children}
    </Badge>
  );
}

/**
 * Count badge (for showing numbers)
 */
export function CountBadge({ count, variant = 'default' }) {
  return (
    <Badge variant={variant}>
      {count}
    </Badge>
  );
}
