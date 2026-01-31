import { render } from 'preact';
import { App } from './components/core/App';

// Import styles
import './styles/tokens.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/sidebar.css';

/**
 * Initialize Hypatia extension UI
 * Injects sidebar at body level for fixed positioning
 */
function init() {
  console.log('[Hypatia Preact] Initializing sidebar...');

  // Don't initialize if already exists
  if (document.getElementById('hypatia-sidebar-root')) {
    console.log('[Hypatia Preact] Already initialized');
    return;
  }

  // Create sidebar container at body level
  const container = document.createElement('div');
  container.id = 'hypatia-sidebar-root';
  document.body.appendChild(container);

  // Render the app
  render(<App />, container);

  console.log('[Hypatia Preact] Sidebar rendered');
}

/**
 * Wait for Gmail to fully load before initializing
 */
function waitForGmail() {
  const gmailMain = document.querySelector('.nH.bkK') || document.querySelector('.nH.nn');

  if (gmailMain) {
    init();
  } else {
    // Gmail hasn't loaded yet, wait and retry
    console.log('[Hypatia Preact] Waiting for Gmail to load...');
    setTimeout(waitForGmail, 500);
  }
}

// Wait for DOM ready, then wait for Gmail
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForGmail);
} else {
  waitForGmail();
}
