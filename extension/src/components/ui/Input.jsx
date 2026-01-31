import { useRef, useEffect } from 'preact/hooks';

/**
 * Shared hook for auto-focus behavior
 */
function useAutoFocus(autoFocus) {
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
    }
  }, [autoFocus]);

  return ref;
}

/**
 * Shared form field wrapper for label and error display
 */
function FormField({ label, error, children }) {
  return (
    <div class="hypatia-input-wrapper">
      {label && <label class="hypatia-input-label">{label}</label>}
      {children}
      {error && <span class="hypatia-input-error">{error}</span>}
    </div>
  );
}

/**
 * Input component with Gmail-native styling
 *
 * @param {Object} props
 * @param {string} props.label - Input label
 * @param {string} props.error - Error message
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.autoFocus - Auto-focus on mount
 */
export function Input({
  label,
  error,
  className = '',
  autoFocus = false,
  ...props
}) {
  const inputRef = useAutoFocus(autoFocus);

  const inputClasses = [
    'hypatia-input',
    error && 'hypatia-input--error',
    className
  ].filter(Boolean).join(' ');

  return (
    <FormField label={label} error={error}>
      <input ref={inputRef} class={inputClasses} {...props} />
    </FormField>
  );
}

/**
 * Textarea component with Gmail-native styling
 *
 * @param {Object} props
 * @param {string} props.label - Textarea label
 * @param {string} props.error - Error message
 * @param {string} props.className - Additional CSS classes
 * @param {number} props.rows - Number of visible rows
 * @param {boolean} props.autoFocus - Auto-focus on mount
 */
export function Textarea({
  label,
  error,
  className = '',
  rows = 4,
  autoFocus = false,
  ...props
}) {
  const textareaRef = useAutoFocus(autoFocus);

  const textareaClasses = [
    'hypatia-input',
    'hypatia-textarea',
    error && 'hypatia-input--error',
    className
  ].filter(Boolean).join(' ');

  return (
    <FormField label={label} error={error}>
      <textarea ref={textareaRef} class={textareaClasses} rows={rows} {...props} />
    </FormField>
  );
}

/**
 * Search input with icon
 */
export function SearchInput({ placeholder = 'Search...', onSearch, ...props }) {
  return (
    <div class="hypatia-search-input">
      <span class="hypatia-search-input__icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </span>
      <input
        type="search"
        class="hypatia-input hypatia-search-input__field"
        placeholder={placeholder}
        onInput={(e) => onSearch?.(e.target.value)}
        {...props}
      />
    </div>
  );
}
