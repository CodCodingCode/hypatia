/**
 * Generate consistent color for initials based on name
 */
function getAvatarColor(name) {
  const colors = [
    { bg: '#e8f0fe', text: '#1a73e8' }, // Blue
    { bg: '#fce8e6', text: '#c5221f' }, // Red
    { bg: '#e6f4ea', text: '#137333' }, // Green
    { bg: '#fef7e0', text: '#b06000' }, // Yellow
    { bg: '#f3e8fd', text: '#8430ce' }, // Purple
    { bg: '#e4f7fb', text: '#007b83' }, // Teal
    { bg: '#fce8f4', text: '#b93a86' }, // Pink
    { bg: '#fff0e1', text: '#c54b22' }  // Orange
  ];

  // Simple hash based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Get initials from name
 */
function getInitials(name) {
  if (!name) return '?';

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }

  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Avatar component
 *
 * @param {Object} props
 * @param {string} props.name - Name for initials
 * @param {string} props.src - Image URL (optional)
 * @param {'sm' | 'md' | 'lg'} props.size - Avatar size
 * @param {string} props.className - Additional CSS classes
 */
export function Avatar({
  name = '',
  src,
  size = 'md',
  className = '',
  ...props
}) {
  const initials = getInitials(name);
  const colors = getAvatarColor(name);

  const classes = [
    'hypatia-avatar',
    size !== 'md' && `hypatia-avatar--${size}`,
    className
  ].filter(Boolean).join(' ');

  if (src) {
    return (
      <div class={classes} {...props}>
        <img src={src} alt={name} />
      </div>
    );
  }

  return (
    <div
      class={classes}
      style={{
        backgroundColor: colors.bg,
        color: colors.text
      }}
      title={name}
      {...props}
    >
      {initials}
    </div>
  );
}

/**
 * Avatar group for showing multiple avatars stacked
 */
export function AvatarGroup({ avatars, max = 3, size = 'sm' }) {
  const visible = avatars.slice(0, max);
  const remaining = avatars.length - max;

  return (
    <div class="hypatia-flex" style={{ marginLeft: '8px' }}>
      {visible.map((avatar, i) => (
        <div
          key={i}
          style={{
            marginLeft: i > 0 ? '-8px' : 0,
            zIndex: visible.length - i
          }}
        >
          <Avatar
            name={avatar.name}
            src={avatar.src}
            size={size}
            style={{
              border: '2px solid var(--hypatia-bg-primary)'
            }}
          />
        </div>
      ))}
      {remaining > 0 && (
        <div
          class={`hypatia-avatar hypatia-avatar--${size}`}
          style={{
            marginLeft: '-8px',
            backgroundColor: 'var(--hypatia-bg-tertiary)',
            color: 'var(--hypatia-text-secondary)',
            border: '2px solid var(--hypatia-bg-primary)'
          }}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
