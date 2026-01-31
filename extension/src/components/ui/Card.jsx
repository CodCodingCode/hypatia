/**
 * Card component with Gmail-native styling
 *
 * @param {Object} props
 * @param {boolean} props.interactive - Add hover effects for clickable cards
 * @param {boolean} props.selected - Show selected state
 * @param {string} props.className - Additional CSS classes
 * @param {Function} props.onClick - Click handler (also makes card interactive)
 * @param {preact.ComponentChildren} props.children - Card content
 */
export function Card({
  interactive = false,
  selected = false,
  className = '',
  onClick,
  children,
  ...props
}) {
  const isClickable = interactive || onClick;

  const classes = [
    'hypatia-card',
    isClickable && 'hypatia-card--interactive',
    selected && 'hypatia-card--selected',
    className
  ].filter(Boolean).join(' ');

  const handleKeyDown = (e) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick?.(e);
    }
  };

  return (
    <div
      class={classes}
      onClick={onClick}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      tabIndex={isClickable ? 0 : undefined}
      role={isClickable ? 'button' : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Card header section
 */
export function CardHeader({ className = '', children, ...props }) {
  return (
    <div class={`hypatia-card__header ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * Card body section
 */
export function CardBody({ className = '', children, ...props }) {
  return (
    <div class={`hypatia-card__body ${className}`} {...props}>
      {children}
    </div>
  );
}

/**
 * Card footer section
 */
export function CardFooter({ className = '', children, ...props }) {
  return (
    <div class={`hypatia-card__footer ${className}`} {...props}>
      {children}
    </div>
  );
}
