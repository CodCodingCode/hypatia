/**
 * Loading spinner with Gmail-native styling
 *
 * @param {Object} props
 * @param {'sm' | 'md' | 'lg'} props.size - Spinner size
 * @param {string} props.className - Additional CSS classes
 */
export function Spinner({ size = 'md', className = '' }) {
  const classes = [
    'hypatia-spinner',
    size !== 'md' && `hypatia-spinner--${size}`,
    className
  ].filter(Boolean).join(' ');

  return <div class={classes} role="status" aria-label="Loading" />;
}

/**
 * Full-page loading state
 */
export function LoadingScreen({ message = 'Loading...' }) {
  return (
    <div class="hypatia-flex hypatia-flex-col hypatia-items-center hypatia-justify-center hypatia-gap-4" style={{ minHeight: '200px' }}>
      <Spinner size="lg" />
      <p class="hypatia-text-secondary hypatia-text-sm">{message}</p>
    </div>
  );
}
