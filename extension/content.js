// Hypatia Content Script
// Integrates with Gmail and provides onboarding UI

console.log('[Hypatia] ===== SCRIPT LOADED =====');
console.log('[Hypatia] Current URL:', window.location.href);

// =============================================================================
// CONSTANTS
// =============================================================================

const HYPATIA_CONTAINER_ID = 'hypatia-onboarding-container';
const HYPATIA_BUTTON_ID = 'hypatia-signin-button';
const HYPATIA_HASH = 'hypatia';

// Store the previous hash to navigate back
let previousHash = '';

// =============================================================================
// STATE
// =============================================================================

let currentStep = 'welcome'; // welcome, progress, questionnaire, waiting, complete, error, campaigns
let progressData = { current: 0, total: 100 };
let isOnboardingVisible = false;
let lastButtonCheck = 0;
const BUTTON_CHECK_INTERVAL = 500; // ms - throttle for performance
let campaignsData = []; // Stores campaign groups after clustering
let currentUserId = null;
let clusteringAnimationInterval = null;

// Questionnaire state
let userDisplayName = '';
let questionnaireState = {
  currentQuestion: 0,
  answers: {
    displayName: '',
    nameConfirmed: false,
    appPurpose: '',
    userType: '',
    generalCtas: '',
    contactTypes: '',
    referralSource: ''
  },
  isComplete: false
};

let backendState = {
  isComplete: false,
  emailCount: 0,
  campaignsCreated: 0,
  campaigns: []
};

// Questionnaire questions configuration
const QUESTIONNAIRE_QUESTIONS = [
  {
    id: 'name',
    title: 'Is this your name?',
    type: 'name_confirm',
    required: true
  },
  {
    id: 'purpose',
    title: 'What will you use the app for?',
    type: 'text',
    placeholder: 'e.g., Managing client communications, personal email organization...',
    required: true
  },
  {
    id: 'userType',
    title: 'Who are you?',
    type: 'select',
    options: [
      { value: 'student', label: 'Student' },
      { value: 'professional', label: 'Professional' },
      { value: 'business_owner', label: 'Business Owner' },
      { value: 'freelancer', label: 'Freelancer' },
      { value: 'other', label: 'Other' }
    ],
    required: true
  },
  {
    id: 'ctas',
    title: 'What kind of general CTAs do you have?',
    type: 'text',
    placeholder: 'e.g., Schedule meetings, request feedback, send proposals...',
    required: false,
    hint: 'Optional - helps us understand your workflow'
  },
  {
    id: 'contacts',
    title: 'What kind of people do you generally contact?',
    type: 'text',
    placeholder: 'e.g., Clients, colleagues, vendors, friends...',
    required: false,
    hint: 'Optional - helps personalize your experience'
  },
  {
    id: 'referral',
    title: 'Where did you find this app?',
    type: 'select',
    options: [
      { value: 'google_search', label: 'Google Search' },
      { value: 'seo', label: 'Blog / Article' },
      { value: 'facebook', label: 'Facebook' },
      { value: 'twitter', label: 'Twitter / X' },
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'friend', label: 'Friend / Colleague' },
      { value: 'product_hunt', label: 'Product Hunt' },
      { value: 'other', label: 'Other' }
    ],
    required: true
  }
];

// =============================================================================
// GMAIL DOM HELPERS
// =============================================================================

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

// =============================================================================
// TOP RIGHT SIGN-IN BUTTON (always visible)
// =============================================================================

async function addSignInButton() {
  // Check if already added
  if (document.getElementById(HYPATIA_BUTTON_ID)) {
    return;
  }

  try {
    // Wait for the top-right account area (class="gb_Kd gb_Nd gb_Zd" or similar)
    // Gmail's header area where profile pic is
    const headerRight = await waitForElement('header [role="navigation"], .gb_Td, .gb_Ld');

    if (!headerRight) {
      // Fallback: just append to body as fixed button
      addFloatingButton();
      return;
    }

    const button = document.createElement('div');
    button.id = HYPATIA_BUTTON_ID;
    button.className = 'hypatia-signin-btn';
    button.innerHTML = `
      <button class="hypatia-header-btn" id="hypatia-header-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12 L11 15 L16 10"/>
        </svg>
        <span>Sign in to Hypatia</span>
      </button>
    `;

    // Insert at the beginning of the header right area
    headerRight.insertBefore(button, headerRight.firstChild);

    // Attach click handler
    document.getElementById('hypatia-header-btn').addEventListener('click', toggleOnboarding);

  } catch (error) {
    console.log('Header not found, using floating button');
    addFloatingButton();
  }
}

function addFloatingButton() {
  console.log('[Hypatia] addFloatingButton called');

  if (document.getElementById(HYPATIA_BUTTON_ID)) {
    console.log('[Hypatia] Button already exists, skipping');
    return;
  }

  // Try to find the gb_Ke element to insert after
  const gbKeElement = document.querySelector('.gb_Ke');

  if (!gbKeElement) {
    console.log('[Hypatia] gb_Ke element not found, retrying in 1000ms');
    setTimeout(addFloatingButton, 1000);
    return;
  }

  console.log('[Hypatia] Found gb_Ke element, injecting button after it...');

  // Create container
  const container = document.createElement('div');
  container.id = HYPATIA_BUTTON_ID;

  // Create button element
  const btn = document.createElement('button');
  btn.id = 'hypatia-header-btn';
  btn.textContent = '✓ Hypatia';

  // Style container to fit in the toolbar
  container.setAttribute('style', `
    display: flex !important;
    align-items: center !important;
    margin-left: 8px !important;
    visibility: visible !important;
    opacity: 1 !important;
  `.replace(/\n/g, ''));

  // Style button to match Gmail's toolbar aesthetic
  btn.setAttribute('style', `
    display: inline-flex !important;
    align-items: center !important;
    visibility: visible !important;
    opacity: 1 !important;
    padding: 8px 16px !important;
    background: #4285f4 !important;
    color: white !important;
    border: none !important;
    border-radius: 20px !important;
    font-family: 'Google Sans', Arial, sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
    line-height: 1 !important;
    white-space: nowrap !important;
  `.replace(/\n/g, ''));

  container.appendChild(btn);

  // Insert after the gb_Ke element
  gbKeElement.parentNode.insertBefore(container, gbKeElement.nextSibling);
  console.log('[Hypatia] Button injected after gb_Ke element');

  btn.addEventListener('click', toggleOnboarding);
  console.log('[Hypatia] Click handler attached');
}

function updateButtonState(isComplete) {
  const btn = document.getElementById('hypatia-header-btn');
  if (btn) {
    if (isComplete) {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12 L11 15 L16 10"/>
        </svg>
        <span>Hypatia</span>
      `;
      btn.classList.add('hypatia-btn-complete');
    }
  }
}

// =============================================================================
// BUTTON PERSISTENCE (keeps button visible when Gmail re-renders)
// =============================================================================

function ensureButtonExists() {
  const container = document.getElementById(HYPATIA_BUTTON_ID);
  if (!container) {
    console.log('[Hypatia] Button missing from DOM, re-adding...');
    addFloatingButton();
  } else {
    // Force visibility on container
    container.setAttribute('style', 'display:flex!important;align-items:center!important;margin-left:8px!important;visibility:visible!important;opacity:1!important;');

    // Also force visibility on the inner button
    const innerBtn = document.getElementById('hypatia-header-btn');
    if (innerBtn) {
      innerBtn.setAttribute('style', 'display:inline-flex!important;align-items:center!important;visibility:visible!important;opacity:1!important;padding:8px 16px!important;background:#4285f4!important;color:white!important;border:none!important;border-radius:20px!important;font-family:Google Sans,Arial,sans-serif!important;font-size:13px!important;font-weight:500!important;cursor:pointer!important;box-shadow:0 1px 3px rgba(0,0,0,0.2)!important;line-height:1!important;white-space:nowrap!important;');
    }
  }
}

function setupButtonPersistence() {
  // Use setInterval for more reliable checking (MutationObserver can miss some changes)
  setInterval(ensureButtonExists, 500);
  console.log('[Hypatia] Button persistence interval started');
}

// =============================================================================
// HASH-BASED NAVIGATION
// =============================================================================

function isHypatiaHash() {
  return window.location.hash === `#${HYPATIA_HASH}`;
}

function navigateToHypatia() {
  // Store current hash to navigate back later
  if (!isHypatiaHash()) {
    previousHash = window.location.hash || '#inbox';
  }
  window.location.hash = HYPATIA_HASH;
}

function navigateBack() {
  // Go back to previous Gmail view
  window.location.hash = previousHash || 'inbox';
}

function handleHashChange() {
  console.log('[Hypatia] Hash changed to:', window.location.hash);

  if (isHypatiaHash()) {
    showOnboardingPanel();
  } else {
    // If we're on a different hash and panel is visible, hide it
    if (isOnboardingVisible) {
      hideOnboardingPanelInternal();
    }
  }
}

// =============================================================================
// ONBOARDING PANEL
// =============================================================================

function toggleOnboarding() {
  if (isHypatiaHash()) {
    navigateBack();
  } else {
    navigateToHypatia();
  }
}

function showOnboardingPanel() {
  // Remove existing container directly (no animation to avoid race condition)
  const existing = document.getElementById(HYPATIA_CONTAINER_ID);
  if (existing) {
    existing.remove();
  }

  isOnboardingVisible = true;

  const container = document.createElement('div');
  container.id = HYPATIA_CONTAINER_ID;
  container.innerHTML = `
    <div class="hypatia-panel">
      <button class="hypatia-close-btn" id="hypatia-close-btn" title="Back to Gmail">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="hypatia-panel-content${currentStep === 'campaigns' ? ' hypatia-fullwidth' : ''}">
        ${getStepContent()}
      </div>
    </div>
  `;

  // Inject into Gmail's main content area instead of body
  const gmailMain = document.querySelector('.nH.bkK') || document.body;
  gmailMain.style.position = 'relative';
  gmailMain.appendChild(container);

  // Trigger fade-in animation
  requestAnimationFrame(() => {
    container.classList.add('hypatia-visible');
    console.log('[Hypatia] Panel opened at #hypatia');
  });

  // Attach event listeners
  attachEventListeners();

  // Close button navigates back
  document.getElementById('hypatia-close-btn').addEventListener('click', navigateBack);
}

// Internal hide function (doesn't change URL)
function hideOnboardingPanelInternal() {
  console.log('[Hypatia] Hiding panel...');

  const container = document.getElementById(HYPATIA_CONTAINER_ID);
  if (container) {
    container.classList.remove('hypatia-visible');
    // Remove after fade-out transition completes
    setTimeout(() => {
      container.remove();
      console.log('[Hypatia] Panel removed');
    }, 300);
  }
  isOnboardingVisible = false;
}

// Public hide function (also navigates away)
function hideOnboardingPanel() {
  navigateBack();
}

function getStepContent() {
  switch (currentStep) {
    case 'welcome':
      return getWelcomeStep();
    case 'loading':
      return getLoadingStep();
    case 'progress':
      return getProgressStep();
    case 'questionnaire':
      return getQuestionnaireStep();
    case 'waiting':
      return getWaitingStep();
    case 'complete':
      return getCompleteStep();
    case 'campaigns':
      return getCampaignsStep();
    case 'error':
      return getErrorStep();
    default:
      return getWelcomeStep();
  }
}

function getLoadingStep() {
  return `
    <div class="hypatia-step hypatia-loading">
      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>
      <p class="hypatia-subtitle">Loading...</p>
    </div>
  `;
}

function getWelcomeStep() {
  return `
    <div class="hypatia-step hypatia-welcome">
      <div class="hypatia-logo">
        <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" stroke="#4285f4" stroke-width="3" fill="none"/>
          <path d="M20 32 L28 40 L44 24" stroke="#4285f4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>

      <h1 class="hypatia-title">Welcome to Hypatia</h1>

      <p class="hypatia-subtitle">
        Your personal email intelligence assistant
      </p>

      <div class="hypatia-explanation">
        <h3>How Hypatia Works</h3>
        <p>
          Hypatia learns your unique communication style by analyzing your sent emails.
          This helps us understand how you write so we can help you write better emails faster.
        </p>

        <div class="hypatia-features">
          <div class="hypatia-feature">
            <div class="hypatia-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div class="hypatia-feature-text">
              <strong>What we analyze</strong>
              <span>Your 200 most recent sent emails</span>
            </div>
          </div>

          <div class="hypatia-feature">
            <div class="hypatia-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div class="hypatia-feature-text">
              <strong>Your privacy matters</strong>
              <span>Data encrypted, never shared</span>
            </div>
          </div>

          <div class="hypatia-feature">
            <div class="hypatia-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div class="hypatia-feature-text">
              <strong>One-time setup</strong>
              <span>Takes just a moment</span>
            </div>
          </div>
        </div>
      </div>

      <button class="hypatia-btn hypatia-btn-primary" id="hypatia-start-btn">
        Get Started
      </button>

      <p class="hypatia-privacy-note">
        By continuing, you agree to let Hypatia analyze your sent emails.
      </p>
    </div>
  `;
}

// Clustering phase messages that rotate for entertainment
const CLUSTERING_MESSAGES = [
  'Grouping emails into categories...',
  'Finding patterns in your emails...',
  'Analyzing writing styles...',
  'Discovering email clusters...',
  'Comparing message similarity...',
  'Organizing your conversations...',
  'Identifying unique campaigns...',
  'Connecting the dots...',
  'Almost there...',
];

function getProgressStep() {
  const percentage = Math.round((progressData.current / progressData.total) * 100);
  const isClustering = progressData.step === 'clustering';

  // If clustering, start the animation
  if (isClustering) {
    startClusteringAnimation();
  }

  return `
    <div class="hypatia-step hypatia-progress">
      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>

      <h2 class="hypatia-title">${isClustering ? 'Grouping Your Emails' : 'Analyzing Your Emails'}</h2>

      <p class="hypatia-subtitle" id="hypatia-status-message">
        ${progressData.message || 'Fetching your sent emails...'}
      </p>

      ${isClustering ? `
        <div class="hypatia-progress-container" id="hypatia-clustering-progress">
          <div class="hypatia-progress-bar">
            <div class="hypatia-progress-fill hypatia-progress-animated" id="hypatia-clustering-fill" style="width: 0%"></div>
          </div>
        </div>
      ` : `
        <div class="hypatia-progress-container" id="hypatia-progress-container">
          <div class="hypatia-progress-bar">
            <div class="hypatia-progress-fill" style="width: ${percentage}%"></div>
          </div>
          <div class="hypatia-progress-text">
            <span id="hypatia-progress-current">${progressData.current}</span>
            <span> / </span>
            <span id="hypatia-progress-total">${progressData.total}</span>
            <span> emails</span>
          </div>
        </div>
        <p class="hypatia-hint">
          Please keep this tab open while we analyze.
        </p>
      `}
    </div>
  `;
}

function startClusteringAnimation() {
  // Clear any existing animation
  if (clusteringAnimationInterval) {
    clearInterval(clusteringAnimationInterval);
  }

  let progress = 0;
  let messageIndex = 0;

  clusteringAnimationInterval = setInterval(() => {
    const fill = document.getElementById('hypatia-clustering-fill');
    const statusMessage = document.getElementById('hypatia-status-message');

    if (!fill) {
      // Element not in DOM, stop animation
      clearInterval(clusteringAnimationInterval);
      clusteringAnimationInterval = null;
      return;
    }

    // Increment progress (slow down as it approaches 90%)
    if (progress < 90) {
      const increment = Math.max(0.5, (90 - progress) / 30);
      progress = Math.min(90, progress + increment);
      fill.style.width = `${progress}%`;
    }

    // Rotate messages every ~2 seconds (interval is ~100ms, so every 20 ticks)
    if (progress > 5 && Math.floor(progress) % 12 === 0) {
      messageIndex = (messageIndex + 1) % CLUSTERING_MESSAGES.length;
      const newMessage = CLUSTERING_MESSAGES[messageIndex];
      if (statusMessage) statusMessage.textContent = newMessage;
    }
  }, 100);
}

function stopClusteringAnimation() {
  if (clusteringAnimationInterval) {
    clearInterval(clusteringAnimationInterval);
    clusteringAnimationInterval = null;
  }

  // Complete the progress bar
  const fill = document.getElementById('hypatia-clustering-fill');
  if (fill) {
    fill.style.width = '100%';
  }
}

function getCompleteStep() {
  const campaignCount = progressData.campaignsCreated || campaignsData.length || 0;

  return `
    <div class="hypatia-step hypatia-complete">
      <div class="hypatia-success-icon">
        <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="38" stroke="#34a853" stroke-width="3" fill="none"/>
          <path d="M24 40 L35 51 L56 30" stroke="#34a853" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>

      <h2 class="hypatia-title">Setup Complete!</h2>

      <p class="hypatia-subtitle">
        Analyzed <strong>${progressData.emailCount || progressData.current}</strong> emails
        ${campaignCount > 0 ? `into <strong>${campaignCount}</strong> categories` : 'successfully'}.
      </p>

      <div class="hypatia-complete-info">
        <p>
          Hypatia has learned your writing style and grouped your emails into categories.
        </p>
      </div>

      ${campaignCount > 0 ? `
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-view-campaigns-btn">
          View Email Categories
        </button>

        <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-done-btn">
          Done
        </button>
      ` : `
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-done-btn">
          Done
        </button>
      `}
    </div>
  `;
}

function getCampaignsStep() {
  const campaigns = campaignsData.slice(0, 10); // Show top 10

  let campaignCardsHtml = '';
  if (campaigns.length === 0) {
    campaignCardsHtml = '<p class="hypatia-no-campaigns">No email categories found.</p>';
  } else {
    campaignCardsHtml = campaigns.map((campaign, idx) => {
      // Build analysis rows if data exists
      let analysisHtml = '';
      if (campaign.contact_description || campaign.style_description || campaign.cta_type) {
        analysisHtml = '<div class="hypatia-campaign-analysis">';

        if (campaign.contact_description) {
          analysisHtml += `
            <div class="hypatia-campaign-analysis-row">
              <span class="hypatia-analysis-icon">Who:</span>
              <span class="hypatia-analysis-text">${escapeHtml(campaign.contact_description)}</span>
            </div>`;
        }

        if (campaign.style_description) {
          analysisHtml += `
            <div class="hypatia-campaign-analysis-row">
              <span class="hypatia-analysis-icon">Style:</span>
              <span class="hypatia-analysis-text">${escapeHtml(campaign.style_description)}</span>
            </div>`;
        }

        if (campaign.cta_type) {
          const urgencyBadge = campaign.cta_urgency ? ` <span class="hypatia-urgency-${campaign.cta_urgency}">${campaign.cta_urgency}</span>` : '';
          const ctaText = campaign.cta_description || campaign.cta_type;
          analysisHtml += `
            <div class="hypatia-campaign-analysis-row">
              <span class="hypatia-analysis-icon">Ask:</span>
              <span class="hypatia-analysis-text">${escapeHtml(ctaText)}${urgencyBadge}</span>
            </div>`;
        }

        analysisHtml += '</div>';
      }

      return `
      <div class="hypatia-campaign-card" data-campaign-id="${campaign.id || idx}">
        <div class="hypatia-campaign-card-header">
          <span class="hypatia-campaign-count">${campaign.email_count}</span>
          ${campaign.avg_similarity ? `<span class="hypatia-campaign-similarity">${Math.round(campaign.avg_similarity * 100)}% similar</span>` : ''}
        </div>
        <div class="hypatia-campaign-card-title">${escapeHtml(truncate(campaign.representative_subject || 'Untitled', 60))}</div>
        <div class="hypatia-campaign-card-recipient">${escapeHtml(truncate(campaign.representative_recipient || '', 40))}</div>
        ${analysisHtml}
      </div>`;
    }).join('');
  }

  const moreCount = campaignsData.length > 10 ? campaignsData.length - 10 : 0;

  return `
    <div class="hypatia-step hypatia-campaigns">
      <div class="hypatia-campaigns-header">
        <div class="hypatia-campaigns-header-left">
          <h2 class="hypatia-title">Your Email Categories</h2>
          <p class="hypatia-subtitle">
            ${campaignsData.length} unique categories identified from ${progressData.emailCount || 'your'} emails
          </p>
        </div>
        <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-add-campaign-btn">
          + Add New Campaign
        </button>
      </div>

      <div class="hypatia-campaigns-grid">
        ${campaignCardsHtml}
      </div>

      ${moreCount > 0 ? `<p class="hypatia-more-campaigns">...and ${moreCount} more categories</p>` : ''}

      <button class="hypatia-btn hypatia-btn-primary" id="hypatia-done-btn">
        Done
      </button>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function getErrorStep() {
  return `
    <div class="hypatia-step hypatia-error">
      <div class="hypatia-error-icon">
        <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="38" stroke="#ea4335" stroke-width="3" fill="none"/>
          <line x1="28" y1="28" x2="52" y2="52" stroke="#ea4335" stroke-width="4" stroke-linecap="round"/>
          <line x1="52" y1="28" x2="28" y2="52" stroke="#ea4335" stroke-width="4" stroke-linecap="round"/>
        </svg>
      </div>

      <h2 class="hypatia-title">Something Went Wrong</h2>

      <p class="hypatia-subtitle hypatia-error-message">
        ${progressData.message || 'An unexpected error occurred.'}
      </p>

      <button class="hypatia-btn hypatia-btn-primary" id="hypatia-retry-btn">
        Try Again
      </button>

      <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-cancel-btn">
        Cancel
      </button>
    </div>
  `;
}

// =============================================================================
// QUESTIONNAIRE STEPS
// =============================================================================

function getQuestionnaireStep() {
  const question = QUESTIONNAIRE_QUESTIONS[questionnaireState.currentQuestion];
  const isLastQuestion = questionnaireState.currentQuestion === QUESTIONNAIRE_QUESTIONS.length - 1;
  const progress = ((questionnaireState.currentQuestion + 1) / QUESTIONNAIRE_QUESTIONS.length) * 100;

  return `
    <div class="hypatia-step hypatia-questionnaire">
      <div class="hypatia-questionnaire-progress">
        <div class="hypatia-questionnaire-progress-bar">
          <div class="hypatia-questionnaire-progress-fill" style="width: ${progress}%"></div>
        </div>
        <span class="hypatia-questionnaire-progress-text">
          Question ${questionnaireState.currentQuestion + 1} of ${QUESTIONNAIRE_QUESTIONS.length}
        </span>
      </div>

      <h2 class="hypatia-title">${question.title}</h2>

      ${question.hint ? `<p class="hypatia-hint">${question.hint}</p>` : ''}

      <div class="hypatia-question-content">
        ${getQuestionInput(question)}
      </div>

      <div class="hypatia-questionnaire-buttons">
        ${questionnaireState.currentQuestion > 0 ? `
          <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-prev-btn">
            Back
          </button>
        ` : ''}
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-next-btn">
          ${isLastQuestion ? 'Finish' : 'Next'}
        </button>
      </div>

      ${!question.required ? `
        <button class="hypatia-btn-skip" id="hypatia-skip-btn">
          Skip this question
        </button>
      ` : ''}
    </div>
  `;
}

function getQuestionInput(question) {
  switch (question.type) {
    case 'name_confirm':
      return `
        <div class="hypatia-name-confirm">
          <input
            type="text"
            class="hypatia-input"
            id="hypatia-name-input"
            value="${escapeHtml(questionnaireState.answers.displayName || userDisplayName)}"
            placeholder="Enter your name"
          />
          <label class="hypatia-checkbox-label">
            <input
              type="checkbox"
              id="hypatia-name-confirmed"
              ${questionnaireState.answers.nameConfirmed ? 'checked' : ''}
            />
            <span>This name is correct</span>
          </label>
        </div>
      `;

    case 'text':
      const textValue = getAnswerValue(question.id);
      return `
        <textarea
          class="hypatia-textarea"
          id="hypatia-text-input"
          placeholder="${question.placeholder || ''}"
          rows="3"
        >${escapeHtml(textValue)}</textarea>
      `;

    case 'select':
      const selectValue = getAnswerValue(question.id);
      return `
        <div class="hypatia-select-options">
          ${question.options.map(opt => `
            <label class="hypatia-radio-label ${selectValue === opt.value ? 'selected' : ''}">
              <input
                type="radio"
                name="hypatia-select"
                value="${opt.value}"
                ${selectValue === opt.value ? 'checked' : ''}
              />
              <span>${opt.label}</span>
            </label>
          `).join('')}
        </div>
      `;

    default:
      return '';
  }
}

function getAnswerValue(questionId) {
  const mapping = {
    'purpose': 'appPurpose',
    'userType': 'userType',
    'ctas': 'generalCtas',
    'contacts': 'contactTypes',
    'referral': 'referralSource'
  };
  return questionnaireState.answers[mapping[questionId]] || '';
}

function getBackendStatusIndicator() {
  if (backendState.isComplete) {
    return `
      <div class="hypatia-backend-complete">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12 L11 15 L16 10"/>
        </svg>
        <span>Email analysis complete</span>
      </div>
    `;
  }
  return `
    <div class="hypatia-backend-processing">
      <div class="hypatia-mini-spinner"></div>
      <span>Analyzing emails in background...</span>
    </div>
  `;
}

function getWaitingStep() {
  return `
    <div class="hypatia-step hypatia-waiting">
      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>

      <h2 class="hypatia-title">Almost Done!</h2>

      <p class="hypatia-subtitle">
        Thank you for completing the questionnaire. We're finishing up the email analysis...
      </p>

      <div class="hypatia-waiting-animation">
        <div class="hypatia-pulse-dot"></div>
        <div class="hypatia-pulse-dot"></div>
        <div class="hypatia-pulse-dot"></div>
      </div>

      <p class="hypatia-hint">
        This usually takes just a few more seconds.
      </p>
    </div>
  `;
}

function updatePanelContent() {
  const content = document.querySelector('.hypatia-panel-content');
  if (content) {
    content.innerHTML = getStepContent();
    // Use full-width layout for campaigns view
    if (currentStep === 'campaigns') {
      content.classList.add('hypatia-fullwidth');
    } else {
      content.classList.remove('hypatia-fullwidth');
    }
    attachEventListeners();
  }
}

function updateProgress(current, total) {
  progressData.current = current;
  progressData.total = total;

  const percentage = Math.round((current / total) * 100);

  const progressFill = document.querySelector('.hypatia-progress-fill');
  const currentEl = document.getElementById('hypatia-progress-current');
  const totalEl = document.getElementById('hypatia-progress-total');

  if (progressFill) progressFill.style.width = `${percentage}%`;
  if (currentEl) currentEl.textContent = current;
  if (totalEl) totalEl.textContent = total;
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

function attachEventListeners() {
  const startBtn = document.getElementById('hypatia-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', handleStartOnboarding);
  }

  const doneBtn = document.getElementById('hypatia-done-btn');
  if (doneBtn) {
    doneBtn.addEventListener('click', handleDone);
  }

  const retryBtn = document.getElementById('hypatia-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', handleStartOnboarding);
  }

  const cancelBtn = document.getElementById('hypatia-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideOnboardingPanel);
  }

  const viewCampaignsBtn = document.getElementById('hypatia-view-campaigns-btn');
  if (viewCampaignsBtn) {
    viewCampaignsBtn.addEventListener('click', handleViewCampaigns);
  }

  // Questionnaire navigation
  const nextBtn = document.getElementById('hypatia-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', handleQuestionnaireNext);
  }

  const prevBtn = document.getElementById('hypatia-prev-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', handleQuestionnairePrev);
  }

  const skipBtn = document.getElementById('hypatia-skip-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', handleQuestionnaireSkip);
  }

  // Radio button selection highlighting
  const radioLabels = document.querySelectorAll('.hypatia-radio-label');
  radioLabels.forEach(label => {
    label.addEventListener('click', () => {
      radioLabels.forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
    });
  });
}

function handleViewCampaigns() {
  currentStep = 'campaigns';
  updatePanelContent();
}

function handleStartOnboarding() {
  // Go directly to questionnaire, backend runs silently
  currentStep = 'questionnaire';
  questionnaireState.currentQuestion = 0;
  questionnaireState.isComplete = false;
  backendState.isComplete = false;
  updatePanelContent();

  // Send message to background script to start the process
  chrome.runtime.sendMessage({ action: 'startOnboarding' });
}

function handleDone() {
  hideOnboardingPanel();
  updateButtonState(true);
}

// =============================================================================
// QUESTIONNAIRE HANDLERS
// =============================================================================

function handleQuestionnaireNext() {
  const question = QUESTIONNAIRE_QUESTIONS[questionnaireState.currentQuestion];

  // Collect current answer
  if (!collectCurrentAnswer(question)) {
    // Validation failed for required field
    return;
  }

  // Check if last question
  if (questionnaireState.currentQuestion === QUESTIONNAIRE_QUESTIONS.length - 1) {
    handleQuestionnaireComplete();
  } else {
    questionnaireState.currentQuestion++;
    updatePanelContent();
  }
}

function handleQuestionnairePrev() {
  // Save current answer before going back
  const question = QUESTIONNAIRE_QUESTIONS[questionnaireState.currentQuestion];
  collectCurrentAnswer(question);

  if (questionnaireState.currentQuestion > 0) {
    questionnaireState.currentQuestion--;
    updatePanelContent();
  }
}

function handleQuestionnaireSkip() {
  questionnaireState.currentQuestion++;
  updatePanelContent();
}

function collectCurrentAnswer(question) {
  switch (question.type) {
    case 'name_confirm':
      const nameInput = document.getElementById('hypatia-name-input');
      const nameConfirmed = document.getElementById('hypatia-name-confirmed');
      questionnaireState.answers.displayName = nameInput?.value?.trim() || '';
      questionnaireState.answers.nameConfirmed = nameConfirmed?.checked || false;

      if (question.required && !questionnaireState.answers.displayName) {
        showValidationError('Please enter your name');
        return false;
      }
      return true;

    case 'text':
      const textInput = document.getElementById('hypatia-text-input');
      const textValue = textInput?.value?.trim() || '';

      const textMapping = {
        'purpose': 'appPurpose',
        'ctas': 'generalCtas',
        'contacts': 'contactTypes'
      };
      questionnaireState.answers[textMapping[question.id]] = textValue;

      if (question.required && !textValue) {
        showValidationError('This field is required');
        return false;
      }
      return true;

    case 'select':
      const selected = document.querySelector('input[name="hypatia-select"]:checked');
      const selectValue = selected?.value || '';

      const selectMapping = {
        'userType': 'userType',
        'referral': 'referralSource'
      };
      questionnaireState.answers[selectMapping[question.id]] = selectValue;

      if (question.required && !selectValue) {
        showValidationError('Please select an option');
        return false;
      }
      return true;

    default:
      return true;
  }
}

function showValidationError(message) {
  // Remove existing error
  const existingError = document.querySelector('.hypatia-validation-error');
  if (existingError) {
    existingError.remove();
  }

  // Create validation error element
  const errorEl = document.createElement('div');
  errorEl.className = 'hypatia-validation-error';
  errorEl.textContent = message;

  const questionContent = document.querySelector('.hypatia-question-content');
  if (questionContent) {
    questionContent.appendChild(errorEl);
  }

  // Auto-hide after 3 seconds
  setTimeout(() => {
    errorEl?.remove();
  }, 3000);
}

function handleQuestionnaireComplete() {
  questionnaireState.isComplete = true;

  // Submit answers to background script
  chrome.runtime.sendMessage({
    action: 'submitQuestionnaire',
    userId: currentUserId,
    answers: questionnaireState.answers
  }, (response) => {
    if (!response?.success) {
      console.error('Failed to save questionnaire:', response?.error);
    }
  });

  // Check if both processes are complete
  checkBothProcessesComplete();
}

function checkBothProcessesComplete() {
  if (questionnaireState.isComplete && backendState.isComplete) {
    // Both done - show complete screen
    currentStep = 'complete';
    progressData.emailCount = backendState.emailCount;
    progressData.campaignsCreated = backendState.campaignsCreated;
    campaignsData = backendState.campaigns;

    // Mark onboarding complete
    chrome.runtime.sendMessage({
      action: 'markOnboardingDone',
      userId: currentUserId
    });

    updatePanelContent();
    updateButtonState(true);
  } else if (questionnaireState.isComplete && !backendState.isComplete) {
    // Questionnaire done, waiting for backend
    currentStep = 'waiting';
    updatePanelContent();
  }
  // If backend is complete but questionnaire isn't, user continues questionnaire
}

// =============================================================================
// MESSAGE LISTENER (from background script)
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'onboardingProgress') {
    handleProgressUpdate(message);
  }
});

function handleProgressUpdate(data) {
  switch (data.step) {
    case 'auth':
      progressData.message = data.message;
      if (data.displayName) {
        userDisplayName = data.displayName;
      }
      const statusAuth = document.getElementById('hypatia-status-message');
      if (statusAuth) statusAuth.textContent = data.message;
      break;

    case 'setup':
      progressData.message = data.message;
      const statusSetup = document.getElementById('hypatia-status-message');
      if (statusSetup) statusSetup.textContent = data.message;
      break;

    case 'questionnaire_start':
      // Backend is starting - switch to questionnaire immediately
      currentUserId = data.userId;
      userDisplayName = data.displayName || '';
      questionnaireState.answers.displayName = userDisplayName;
      questionnaireState.currentQuestion = 0;
      questionnaireState.isComplete = false;
      backendState.isComplete = false;
      currentStep = 'questionnaire';
      updatePanelContent();
      break;

    case 'backend_progress':
      // Update backend status indicator without changing step
      // Could update a mini progress indicator if desired
      const backendStatus = document.getElementById('hypatia-backend-status');
      if (backendStatus) {
        backendStatus.innerHTML = getBackendStatusIndicator();
      }
      break;

    case 'backend_complete':
      // Backend processing finished
      backendState.isComplete = true;
      backendState.emailCount = data.emailCount;
      backendState.campaignsCreated = data.campaignsCreated;
      backendState.campaigns = data.campaigns || [];

      // Update status indicator
      const statusEl = document.getElementById('hypatia-backend-status');
      if (statusEl) {
        statusEl.innerHTML = getBackendStatusIndicator();
      }

      // Check if both processes are complete
      checkBothProcessesComplete();
      break;

    case 'fetching':
      progressData.message = data.message || 'Fetching your sent emails...';
      if (data.current !== undefined) {
        updateProgress(data.current, data.total);
      }
      const statusFetch = document.getElementById('hypatia-status-message');
      if (statusFetch && data.message) statusFetch.textContent = data.message;
      break;

    case 'saving':
      progressData.message = data.message;
      const statusSave = document.getElementById('hypatia-status-message');
      if (statusSave) statusSave.textContent = data.message;
      break;

    case 'clustering':
      progressData.step = 'clustering';
      progressData.message = data.message;
      // Re-render to show clustering UI (hides progress bar, changes title)
      updatePanelContent();
      break;

    case 'complete':
      // Stop the clustering animation before transitioning
      stopClusteringAnimation();
      currentStep = 'complete';
      progressData.emailCount = data.emailCount;
      progressData.campaignsCreated = data.campaignsCreated || 0;
      // Store campaigns data for viewing
      if (data.campaigns && data.campaigns.length > 0) {
        campaignsData = data.campaigns;
      }
      updatePanelContent();
      updateButtonState(true);
      break;

    case 'error':
      currentStep = 'error';
      progressData.message = data.message;
      updatePanelContent();
      break;
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

async function init() {
  console.log('[Hypatia] Initializing extension...');

  // Set up hash change listener for navigation
  window.addEventListener('hashchange', handleHashChange);
  console.log('[Hypatia] Hash change listener added');

  // Check if onboarding already completed
  chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, (response) => {
    console.log('[Hypatia] Onboarding status response:', response);
    if (response && response.complete) {
      updateButtonState(true);
    }
  });

  // Add button after a short delay to let Gmail load
  setTimeout(() => {
    console.log('[Hypatia] Adding floating button after delay...');
    addFloatingButton();

    // Set up persistence to re-add button if Gmail removes it during re-renders
    setupButtonPersistence();

    // Check if we're already on #hypatia hash (e.g., page refresh or direct link)
    if (isHypatiaHash()) {
      console.log('[Hypatia] Starting on #hypatia hash, showing panel');
      showOnboardingPanel();
    }
  }, 1000);

  // Also try to add to header when Gmail finishes loading
  setTimeout(tryMoveToHeader, 2000);
  setTimeout(tryMoveToHeader, 4000);

  console.log('[Hypatia] Extension initialized');
}

async function tryMoveToHeader() {
  try {
    const headerRight = document.querySelector('header [role="navigation"], .gb_Td, .gb_Ld, .gb_Je');
    if (headerRight && document.getElementById(HYPATIA_BUTTON_ID)) {
      const existingBtn = document.getElementById(HYPATIA_BUTTON_ID);
      // Move from floating to header if possible
      if (existingBtn.classList.contains('hypatia-floating-btn-container')) {
        existingBtn.classList.remove('hypatia-floating-btn-container');
        existingBtn.classList.add('hypatia-signin-btn');
        headerRight.insertBefore(existingBtn, headerRight.firstChild);
      }
    }
  } catch (e) {
    // Keep floating button
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
