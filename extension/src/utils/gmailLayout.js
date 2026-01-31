import { sidebarOpen } from '../context/AppContext';

/**
 * Gmail layout management utilities
 * Ensures sidebar margin is maintained when Gmail re-renders
 */

let layoutObserver = null;

/**
 * Setup MutationObserver to maintain Gmail layout when DOM changes
 */
export function setupGmailLayoutObserver() {
  if (layoutObserver) {
    layoutObserver.disconnect();
  }

  layoutObserver = new MutationObserver(() => {
    ensureGmailMargin();
  });

  layoutObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial margin setup
  ensureGmailMargin();

  return () => {
    if (layoutObserver) {
      layoutObserver.disconnect();
      layoutObserver = null;
    }
  };
}

/**
 * Ensure Gmail has proper margin when sidebar is open
 */
function ensureGmailMargin() {
  const shouldHaveMargin = sidebarOpen.value;
  const hasMarginClass = document.body.classList.contains('hypatia-sidebar-open');

  if (shouldHaveMargin && !hasMarginClass) {
    document.body.classList.add('hypatia-sidebar-open');
  } else if (!shouldHaveMargin && hasMarginClass) {
    document.body.classList.remove('hypatia-sidebar-open');
  }
}

/**
 * Get Gmail's main content selectors for targeting
 */
export function getGmailContentSelectors() {
  return [
    '.nH.bkK',      // Main content wrapper
    '.nH.nn',       // Alternative main wrapper
    '.aeJ',         // Email list container
    '[role="main"]' // Main content region
  ];
}
