import { signal, effect } from '@preact/signals';

// Global theme signal - reactive across all components
export const gmailTheme = signal('light');
export const isDarkMode = signal(false);

/**
 * Detect Gmail's current theme by analyzing background color luminance
 */
function detectGmailTheme() {
  // Method 1: Check body background color
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const rgb = bodyBg.match(/\d+/g);

  if (rgb && rgb.length >= 3) {
    // Calculate relative luminance
    const luminance = (
      parseInt(rgb[0]) * 299 +
      parseInt(rgb[1]) * 587 +
      parseInt(rgb[2]) * 114
    ) / 1000;

    if (luminance < 128) {
      return 'dark';
    }
  }

  // Method 2: Check for Gmail dark mode indicators
  // Gmail uses certain class patterns for dark mode
  const mainContent = document.querySelector('[role="main"]');
  if (mainContent) {
    const mainBg = getComputedStyle(mainContent).backgroundColor;
    const mainRgb = mainBg.match(/\d+/g);
    if (mainRgb && mainRgb.length >= 3) {
      const mainLuminance = (
        parseInt(mainRgb[0]) * 299 +
        parseInt(mainRgb[1]) * 587 +
        parseInt(mainRgb[2]) * 114
      ) / 1000;
      if (mainLuminance < 128) {
        return 'dark';
      }
    }
  }

  // Method 3: Check for common dark mode body classes
  if (document.body.classList.contains('bv1')) {
    return 'dark';
  }

  return 'light';
}

/**
 * Apply theme to Hypatia container
 */
function applyTheme(theme) {
  const container = document.getElementById('hypatia-root');
  if (container) {
    container.setAttribute('data-hypatia-theme', theme);
  }

  // Also apply to any modal containers
  const modalRoot = document.getElementById('hypatia-modal-root');
  if (modalRoot) {
    modalRoot.setAttribute('data-hypatia-theme', theme);
  }
}

/**
 * Initialize theme detection and watch for changes
 */
export function initThemeDetection() {
  // Initial detection
  const initialTheme = detectGmailTheme();
  gmailTheme.value = initialTheme;
  isDarkMode.value = initialTheme === 'dark';
  applyTheme(initialTheme);

  // Watch for Gmail theme changes via MutationObserver
  const observer = new MutationObserver(() => {
    const newTheme = detectGmailTheme();
    if (newTheme !== gmailTheme.value) {
      gmailTheme.value = newTheme;
      isDarkMode.value = newTheme === 'dark';
      applyTheme(newTheme);
    }
  });

  // Observe body for class and style changes
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: false,
    subtree: false
  });

  // Also observe the main content area if it exists
  const mainContent = document.querySelector('[role="main"]');
  if (mainContent) {
    observer.observe(mainContent, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: false,
      subtree: false
    });
  }

  // Re-apply theme whenever Hypatia container is created
  effect(() => {
    applyTheme(gmailTheme.value);
  });

  return () => observer.disconnect();
}

/**
 * Hook for components to access theme state
 */
export function useGmailTheme() {
  return {
    theme: gmailTheme,
    isDarkMode
  };
}
