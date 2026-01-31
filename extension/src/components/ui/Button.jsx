import { Spinner } from './Spinner';

/**
 * Button component with Gmail-native styling
 *
 * @param {Object} props
 * @param {'primary' | 'secondary' | 'ghost' | 'danger'} props.variant - Button style variant
 * @param {'sm' | 'md' | 'lg'} props.size - Button size
 * @param {boolean} props.fullWidth - Whether button takes full width
 * @param {boolean} props.loading - Show loading spinner
 * @param {boolean} props.disabled - Disable button
 * @param {boolean} props.iconOnly - Icon-only button (no text)
 * @param {string} props.className - Additional CSS classes
 * @param {Function} props.onClick - Click handler
 * @param {preact.ComponentChildren} props.children - Button content
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  iconOnly = false,
  className = '',
  children,
  ...props
}) {
  const classes = [
    'hypatia-btn',
    `hypatia-btn--${variant}`,
    `hypatia-btn--${size}`,
    fullWidth && 'hypatia-btn--full',
    iconOnly && 'hypatia-btn--icon',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      class={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

/**
 * Icon button - convenience wrapper for icon-only buttons
 */
export function IconButton({
  size = 'md',
  variant = 'ghost',
  label,
  children,
  ...props
}) {
  return (
    <Button
      variant={variant}
      size={size}
      iconOnly
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}
