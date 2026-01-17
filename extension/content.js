// Hypatia Content Script
// Integrates with Gmail and provides onboarding UI

console.log('[Hypatia] ===== SCRIPT LOADED =====');
console.log('[Hypatia] Current URL:', window.location.href);

// =============================================================================
// CONSTANTS
// =============================================================================

const HYPATIA_CONTAINER_ID = 'hypatia-onboarding-container';
const HYPATIA_BUTTON_ID = 'hypatia-signin-button';
const HYPATIA_SIDEBAR_ID = 'hypatia-sidebar';
const HYPATIA_HASH = 'hypatia';
const HYPATIA_CAMPAIGN_HASH_PREFIX = 'hypatia/campaign/';
const HYPATIA_DASHBOARD_HASH = 'hypatia/dashboard';

// Store the previous hash to navigate back
let previousHash = '';

// =============================================================================
// STATE
// =============================================================================

let currentStep = 'welcome'; // welcome, progress, questionnaire, waiting, complete, error, campaigns, campaign_detail, leads, template, sent
let progressData = { current: 0, total: 100 };
let isOnboardingVisible = false;
let lastButtonCheck = 0;
const BUTTON_CHECK_INTERVAL = 500; // ms - throttle for performance
let campaignsData = []; // Stores campaign groups after clustering
let currentUserId = null;
let selectedCampaign = null; // Currently selected campaign for detail view
let currentLeads = []; // Leads for the current campaign
let currentTemplate = { subject: '', body: '' }; // Current email template
let clusteringAnimationInterval = null;
let currentCampaignsPage = 1; // Current page for campaigns pagination
const CAMPAIGNS_PER_PAGE = 6; // 3x2 grid
let sidebarInjected = false; // Track if sidebar has been injected

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
  btn.textContent = 'H';

  // Style container to fit in the toolbar
  container.setAttribute('style', `
    display: flex !important;
    align-items: center !important;
    margin-left: 8px !important;
    visibility: visible !important;
    opacity: 1 !important;
  `.replace(/\n/g, ''));

  // Style button - match Gmail's native icon style (like the ? icon)
  btn.setAttribute('style', `
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    visibility: visible !important;
    opacity: 1 !important;
    width: 40px !important;
    height: 40px !important;
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    border-radius: 50% !important;
    cursor: pointer !important;
    line-height: 1 !important;
  `.replace(/\n/g, ''));

  // Use SVG - grey circle border, white fill inside, blue Arial "H"
  btn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="#5f6368" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/>
      <text x="12" y="16.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="500" fill="#4285f4" stroke="none">H</text>
    </svg>
  `;

  container.appendChild(btn);

  // Insert after the gb_Ke element
  gbKeElement.parentNode.insertBefore(container, gbKeElement.nextSibling);
  console.log('[Hypatia] Button injected after gb_Ke element');

  // Add hover effects (needed because inline styles override CSS :hover)
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(0,0,0,0.06)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'transparent';
  });

  btn.addEventListener('click', toggleOnboarding);
  console.log('[Hypatia] Click handler attached');
}

function updateButtonState(isComplete) {
  const btn = document.getElementById('hypatia-header-btn');
  if (btn) {
    if (isComplete) {
      // Keep the "H" but change to green checkmark style
      btn.textContent = 'H';
      btn.style.background = '#34a853';
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
      innerBtn.setAttribute('style', 'display:inline-flex!important;align-items:center!important;justify-content:center!important;visibility:visible!important;opacity:1!important;width:40px!important;height:40px!important;padding:0!important;background:transparent!important;border:none!important;border-radius:50%!important;cursor:pointer!important;line-height:1!important;');
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
  const hash = window.location.hash.slice(1); // Remove the #
  return hash === HYPATIA_HASH || hash.startsWith(HYPATIA_CAMPAIGN_HASH_PREFIX);
}

function getCampaignIdFromHash() {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith(HYPATIA_CAMPAIGN_HASH_PREFIX)) {
    return hash.slice(HYPATIA_CAMPAIGN_HASH_PREFIX.length);
  }
  return null;
}

function navigateToHypatia() {
  // Store current hash to navigate back later
  if (!isHypatiaHash()) {
    previousHash = window.location.hash || '#inbox';
  }
  window.location.hash = HYPATIA_HASH;
}

function navigateToCampaign(campaignId) {
  // Store current hash to navigate back later
  if (!isHypatiaHash()) {
    previousHash = window.location.hash || '#inbox';
  }
  window.location.hash = `${HYPATIA_CAMPAIGN_HASH_PREFIX}${campaignId}`;
}

function navigateToCampaignsList() {
  window.location.hash = HYPATIA_HASH;
}

function navigateBack() {
  // Go back to previous Gmail view
  window.location.hash = previousHash || 'inbox';
}

function handleHashChange() {
  console.log('[Hypatia] Hash changed to:', window.location.hash);
  const hash = window.location.hash.slice(1); // Remove the # prefix

  if (isHypatiaHash()) {
    const campaignId = getCampaignIdFromHash();
    if (campaignId) {
      // Navigate directly to a specific campaign
      loadCampaignFromHash(campaignId);
    } else if (hash === HYPATIA_DASHBOARD_HASH) {
      // Dashboard view
      currentStep = 'dashboard';
      showOnboardingPanel();
    } else {
      // Just show the main Hypatia panel (campaigns)
      showOnboardingPanel();
    }
    // Update sidebar active state
    updateSidebarActiveState();
  } else {
    // If we're on a different hash and panel is visible, hide it
    if (isOnboardingVisible) {
      hideOnboardingPanelInternal();
    }
    // Update sidebar active state (none active)
    updateSidebarActiveState();
  }
}

function loadCampaignFromHash(campaignId) {
  // Find the campaign from data
  let campaign = campaignsData.find(c => String(c.id) === String(campaignId));

  if (campaign) {
    selectedCampaign = campaign;
    currentLeads = campaign.leads || [];
    currentTemplate = campaign.template || { subject: '', body: '' };
    currentStep = 'campaign_detail';
    showOnboardingPanel();
  } else {
    // Campaign not found in local data, show panel and it will use dummy data or fetch
    currentStep = 'campaigns';
    showOnboardingPanel();
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

async function showOnboardingPanel() {
  // Remove existing container directly (no animation to avoid race condition)
  const existing = document.getElementById(HYPATIA_CONTAINER_ID);
  if (existing) {
    existing.remove();
  }

  isOnboardingVisible = true;

  // Check if onboarding was already completed - if so, skip to campaigns
  // This check runs for welcome, signing_in, or any early step to prevent showing onboarding again
  if (currentStep === 'welcome' || currentStep === 'signing_in') {
    const status = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
    });

    if (status && status.complete && status.userId) {
      console.log('[Hypatia] Onboarding already complete, skipping to campaigns...');
      currentUserId = status.userId;

      // Fetch campaigns for this user
      const campaignsResponse = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'getCampaigns', userId: status.userId }, resolve);
      });

      if (campaignsResponse && campaignsResponse.success && campaignsResponse.campaigns) {
        campaignsData = campaignsResponse.campaigns;
      }

      currentStep = 'campaigns';
    }
  }

  const container = document.createElement('div');
  container.id = HYPATIA_CONTAINER_ID;
  container.innerHTML = `
    <div class="hypatia-panel">
      <div class="hypatia-panel-content${(currentStep === 'campaigns' || currentStep === 'campaign_detail') ? ' hypatia-fullwidth' : ''}">
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
    case 'signing_in':
      return getSigningInStep();
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
    case 'campaign_detail':
      return getCampaignDetailStep();
    case 'leads':
      return getLeadsStep();
    case 'template':
      return getTemplateStep();
    case 'sent':
      return getSentStep();
    case 'dashboard':
      return getDashboardStep();
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

function getSigningInStep() {
  return `
    <div class="hypatia-step hypatia-signing-in">
      <div class="hypatia-logo">
        <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" stroke="#4285f4" stroke-width="3" fill="none"/>
          <path d="M20 32 L28 40 L44 24" stroke="#4285f4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>

      <h1 class="hypatia-title">Signing In</h1>

      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>

      <p class="hypatia-subtitle" id="hypatia-signin-status">
        Connecting to your Google account...
      </p>

      <p class="hypatia-hint">
        A Google sign-in popup may appear. Please complete the sign-in to continue.
      </p>
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
  // Use real data if available, otherwise show dummy campaigns for testing
  const allCampaigns = campaignsData.length > 0 ? campaignsData : getDummyCampaigns();
  const isUsingDummyData = campaignsData.length === 0;

  // Calculate pagination
  const totalCampaigns = allCampaigns.length;
  const totalPages = Math.ceil(totalCampaigns / CAMPAIGNS_PER_PAGE);

  // Ensure currentCampaignsPage is within valid range
  if (currentCampaignsPage < 1) currentCampaignsPage = 1;
  if (currentCampaignsPage > totalPages) currentCampaignsPage = totalPages;

  // Get campaigns for current page
  const startIdx = (currentCampaignsPage - 1) * CAMPAIGNS_PER_PAGE;
  const endIdx = startIdx + CAMPAIGNS_PER_PAGE;
  const campaigns = allCampaigns.slice(startIdx, endIdx);

  let campaignCardsHtml = '';
  if (campaigns.length === 0) {
    campaignCardsHtml = '<p class="hypatia-no-campaigns">No email categories found.</p>';
  } else {
    campaignCardsHtml = campaigns.map((campaign, idx) => {
      const globalIdx = startIdx + idx;
      // Build analysis rows if data exists
      let analysisHtml = '';
      if (campaign.contact_description || campaign.style_description || campaign.cta_type) {
        analysisHtml = '<div class="hypatia-campaign-analysis">';

        if (campaign.contact_description) {
          analysisHtml += `
            <div class="hypatia-campaign-analysis-row">
              <span class="hypatia-analysis-icon"><strong>Who:</strong></span>
              <span class="hypatia-analysis-text">${escapeHtml(campaign.contact_description)}</span>
            </div>`;
        }

        if (campaign.style_description) {
          analysisHtml += `
            <div class="hypatia-campaign-analysis-row">
              <span class="hypatia-analysis-icon"><strong>Style:</strong></span>
              <span class="hypatia-analysis-text">${escapeHtml(campaign.style_description)}</span>
            </div>`;
        }

        if (campaign.cta_type) {
          const ctaText = campaign.cta_description || campaign.cta_type;
          analysisHtml += `
            <div class="hypatia-campaign-analysis-row">
              <span class="hypatia-analysis-icon"><strong>Ask:</strong></span>
              <span class="hypatia-analysis-text">${escapeHtml(ctaText)}</span>
            </div>`;
        }

        analysisHtml += '</div>';
      }

      // Get actual emails from Supabase for cycling animation
      const campaignEmails = getCampaignEmails(campaign);
      const emailsDataAttr = escapeHtml(JSON.stringify(campaignEmails));
      const firstEmail = campaignEmails[0] || campaign.representative_recipient || '';

      return `
      <div class="hypatia-campaign-card" data-campaign-id="${campaign.id || globalIdx}" data-emails='${emailsDataAttr}'>
        <div class="hypatia-campaign-card-header">
          <span class="hypatia-campaign-count">${campaign.email_count}</span>
        </div>
        <div class="hypatia-campaign-card-title">${escapeHtml(truncate(campaign.representative_subject || 'Untitled', 50))}</div>
        <div class="hypatia-campaign-card-recipient-cycling">
          <span class="hypatia-cycling-email">${escapeHtml(firstEmail)}</span>
        </div>
        ${analysisHtml}
      </div>`;
    }).join('');
  }

  // Pagination controls
  const paginationHtml = totalPages > 1 ? `
    <div class="hypatia-pagination">
      <button class="hypatia-pagination-btn" id="hypatia-prev-page" ${currentCampaignsPage <= 1 ? 'disabled' : ''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <span class="hypatia-pagination-info">${currentCampaignsPage} / ${totalPages}</span>
      <button class="hypatia-pagination-btn" id="hypatia-next-page" ${currentCampaignsPage >= totalPages ? 'disabled' : ''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>
  ` : '';

  return `
    <div class="hypatia-step hypatia-campaigns">
      <div class="hypatia-campaigns-header">
        <div class="hypatia-campaigns-header-left">
          <h2 class="hypatia-title">Continue Previous Campaigns</h2>
          <p class="hypatia-subtitle">
            ${isUsingDummyData
              ? 'Sample campaigns - click to explore the workflow'
              : `${totalCampaigns} unique campaigns identified from your emails`}
          </p>
        </div>
        <div class="hypatia-header-buttons">
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-add-campaign-btn">
            + Add New Campaign
          </button>
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-campaigns-close-btn">
            Close
          </button>
        </div>
      </div>

      <div class="hypatia-campaigns-grid">
        ${campaignCardsHtml}
      </div>

      ${paginationHtml}
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

// =============================================================================
// EMAIL CYCLING ANIMATION
// =============================================================================

function getCampaignEmails(campaign) {
  // Use actual emails from the campaign data (fetched from Supabase)
  if (campaign.emails && campaign.emails.length > 0) {
    // Extract recipient_to from each email, limit to 8 for cycling
    return campaign.emails.slice(0, 8).map(e => e.recipient_to || e.recipient_email || '').filter(e => e);
  }

  // Fallback to sent_emails if available (for backwards compatibility)
  if (campaign.sent_emails && campaign.sent_emails.length > 0) {
    return campaign.sent_emails.slice(0, 8).map(e => e.recipient_email || e.recipient_to || '').filter(e => e);
  }

  // No emails available - return empty array
  return [];
}

// Store interval references for cleanup
let emailCyclingIntervals = [];

function startEmailCycling() {
  // Clear any existing intervals
  stopEmailCycling();

  const cards = document.querySelectorAll('.hypatia-campaign-card');
  cards.forEach((card, cardIndex) => {
    const emailsData = card.getAttribute('data-emails');
    if (!emailsData) return;

    let emails;
    try {
      emails = JSON.parse(emailsData);
    } catch (e) {
      return;
    }

    if (!emails || emails.length <= 1) return;

    let currentIndex = 0;
    const emailSpan = card.querySelector('.hypatia-cycling-email');
    if (!emailSpan) return;

    // Stagger the start of each card's animation
    const staggerDelay = cardIndex * 500;

    setTimeout(() => {
      const interval = setInterval(() => {
        currentIndex = (currentIndex + 1) % emails.length;

        // Fade out
        emailSpan.classList.add('hypatia-cycling-fade-out');

        setTimeout(() => {
          emailSpan.textContent = emails[currentIndex];
          emailSpan.classList.remove('hypatia-cycling-fade-out');
          emailSpan.classList.add('hypatia-cycling-fade-in');

          setTimeout(() => {
            emailSpan.classList.remove('hypatia-cycling-fade-in');
          }, 300);
        }, 300);
      }, 2500); // Cycle every 2.5 seconds

      emailCyclingIntervals.push(interval);
    }, staggerDelay);
  });
}

function stopEmailCycling() {
  emailCyclingIntervals.forEach(interval => clearInterval(interval));
  emailCyclingIntervals = [];
}

// =============================================================================
// DUMMY DATA FOR TESTING
// =============================================================================

function getDummyCampaigns() {
  return [
    {
      id: 1,
      representative_subject: 'Partnership Opportunity - Let\'s Connect',
      representative_recipient: 'founders@startups.com',
      email_count: 47,
      avg_similarity: 0.89,
      contact_description: 'Startup founders and CEOs in the tech industry, particularly those who have raised Series A or later funding.',
      style_description: 'Professional but friendly, concise',
      style_prompt: 'This sender writes with a professional yet approachable tone. They open emails with a personalized reference to the recipient\'s work or company. Sentences are short and punchy, averaging 10-15 words. They use active voice and avoid jargon. The overall structure follows: brief personal connection, value proposition, clear ask, and friendly sign-off. They often include specific numbers or data points to build credibility. Their vocabulary is accessible but intelligent. They make requests directly without being pushy, often framing asks as mutual benefits. Closing style includes warm sign-offs like "Looking forward to connecting" followed by just their first name.',
      cta_type: 'meeting_request',
      cta_description: 'Request a 15-minute introductory call to discuss potential partnership opportunities and explore synergies between our companies.',
      cta_urgency: 'medium',
      leads: [],
      sent_emails: [],
      template: null
    },
    {
      id: 2,
      representative_subject: 'Quick Question About Your Product',
      representative_recipient: 'product@companies.com',
      email_count: 32,
      avg_similarity: 0.85,
      contact_description: 'Product managers at tech companies with 50-500 employees.',
      style_description: 'Casual and direct',
      style_prompt: 'This sender has a casual, conversational writing style. They often start emails with a quick compliment or observation about the recipient\'s product. Their tone is enthusiastic but not over the top. They ask questions directly and keep paragraphs very short - often just 1-2 sentences. They use contractions freely (I\'m, we\'re, that\'s) and occasionally include light humor. Their vocabulary is everyday and relatable. They avoid formal business speak entirely. Sign-offs are simple like "Thanks!" or "Cheers" followed by their first name only.',
      cta_type: 'feedback_request',
      cta_description: 'Get honest feedback on our product from experienced product managers who can provide actionable insights.',
      cta_urgency: 'low',
      leads: [],
      sent_emails: [],
      template: null
    },
    {
      id: 3,
      representative_subject: 'Following Up - Investment Opportunity',
      representative_recipient: 'investors@vc.com',
      email_count: 28,
      avg_similarity: 0.92,
      contact_description: 'VCs and angel investors focused on B2B SaaS companies.',
      style_description: 'Formal and data-driven',
      style_prompt: 'This sender writes with a formal, metrics-driven approach. They lead with key metrics and traction data (ARR, growth rate, customer count). Sentences are well-structured and complete. They use industry terminology appropriately without overloading. The tone is confident but not arrogant. They structure emails with clear sections: brief intro, key highlights, specific ask. They include social proof and notable achievements. Vocabulary is sophisticated but accessible. They close with professional sign-offs like "Best regards" followed by full name and title. Follow-up emails reference previous conversations specifically.',
      cta_type: 'pitch_meeting',
      cta_description: 'Schedule a 30-minute meeting to present our pitch deck and discuss investment opportunity for our Series A round.',
      cta_urgency: 'high',
      leads: [],
      sent_emails: [],
      template: null
    }
  ];
}

function getDummyLeads() {
  return [
    { name: 'Sarah Chen', email: 'sarah@techstartup.com', title: 'CEO', company: 'TechStartup Inc' },
    { name: 'Michael Rodriguez', email: 'michael@innovate.io', title: 'Founder', company: 'Innovate.io' },
    { name: 'Emily Watson', email: 'emily@growthco.com', title: 'Co-Founder', company: 'GrowthCo' },
    { name: 'David Kim', email: 'david@nextstep.ai', title: 'CEO', company: 'NextStep AI' },
    { name: 'Jessica Liu', email: 'jessica@cloudbase.com', title: 'Founder', company: 'CloudBase' }
  ];
}

function getDummySentEmails() {
  return [
    {
      recipient_name: 'Sarah Chen',
      recipient_email: 'sarah@techstartup.com',
      subject: 'Partnership Opportunity - Let\'s Connect',
      status: 'replied',
      sent_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      opened_at: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString(),
      replied_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi Sarah,\n\nI wanted to reach out regarding a potential partnership...'
    },
    {
      recipient_name: 'Michael Rodriguez',
      recipient_email: 'michael@innovate.io',
      subject: 'Partnership Opportunity - Let\'s Connect',
      status: 'opened',
      sent_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      opened_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi Michael,\n\nI hope this email finds you well...'
    },
    {
      recipient_name: 'Emily Watson',
      recipient_email: 'emily@growthco.com',
      subject: 'Partnership Opportunity - Let\'s Connect',
      status: 'delivered',
      sent_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi Emily,\n\nGreat to connect...'
    }
  ];
}

// =============================================================================
// CAMPAIGN DETAIL STEP
// =============================================================================

function getCampaignDetailStep() {
  const campaign = selectedCampaign || getDummyCampaigns()[0];

  // Get full descriptions - prefer style_prompt over style_description for full detail
  const emailStyleFull = campaign.style_prompt || campaign.style_description || '';
  const ctaDescription = campaign.cta_description || '';
  const contactPreference = campaign.contact_description || '';

  return `
    <div class="hypatia-step hypatia-campaign-detail hypatia-campaign-detail-fullscreen">
      <div class="hypatia-detail-header-bar">
        <div class="hypatia-detail-header-left">
          <input type="text" class="hypatia-campaign-title-input" id="hypatia-campaign-title" value="${escapeHtml(campaign.representative_subject || '')}" placeholder="Campaign Name" />
          <div class="hypatia-detail-subtitle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <input type="text" class="hypatia-campaign-recipient-input" id="hypatia-campaign-recipient" value="${escapeHtml(campaign.representative_recipient || '')}" placeholder="Recipient description (e.g., Startup founders)" />
          </div>
        </div>
        <div class="hypatia-detail-header-buttons">
          <button class="hypatia-detail-btn hypatia-detail-btn-secondary" id="hypatia-back-to-campaigns">
            ← Back to Campaigns
          </button>
        </div>
      </div>

      <!-- Two-column layout: Left (CTA + Contact) | Right (Email Style) -->
      <div class="hypatia-campaign-analysis-grid">
        <!-- Left Column: CTA and Contact Preference -->
        <div class="hypatia-campaign-analysis-left">
          <!-- CTA Description (Editable) -->
          <div class="hypatia-analysis-block">
            <div class="hypatia-analysis-block-header">
              <div class="hypatia-analysis-block-icon hypatia-icon-cta">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <div class="hypatia-analysis-block-title">
                Call to Action
              </div>
            </div>
            <textarea class="hypatia-analysis-block-textarea" id="hypatia-cta-input" placeholder="What do you want recipients to do? e.g., Schedule a meeting, provide feedback, sign up for a demo...">${escapeHtml(ctaDescription)}</textarea>
          </div>

          <!-- Contact Preference (Editable) -->
          <div class="hypatia-analysis-block">
            <div class="hypatia-analysis-block-header">
              <div class="hypatia-analysis-block-icon hypatia-icon-contact">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div class="hypatia-analysis-block-title">Contact Preference</div>
            </div>
            <textarea class="hypatia-analysis-block-textarea" id="hypatia-contact-input" placeholder="Who do you want to contact? e.g., CTOs at Series A startups, Marketing managers at SaaS companies...">${escapeHtml(contactPreference)}</textarea>
          </div>
        </div>

        <!-- Right Column: Email Style -->
        <div class="hypatia-campaign-analysis-right">
          <div class="hypatia-analysis-block hypatia-analysis-block-tall">
            <div class="hypatia-analysis-block-header">
              <div class="hypatia-analysis-block-icon hypatia-icon-style">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                </svg>
              </div>
              <div class="hypatia-analysis-block-title">Email Style</div>
            </div>
            <textarea class="hypatia-analysis-block-textarea hypatia-style-textarea" id="hypatia-style-input" placeholder="Describe your writing style. e.g., Professional but friendly, concise sentences, use first name only in sign-off...">${escapeHtml(emailStyleFull)}</textarea>
          </div>
        </div>
      </div>

      <!-- Bottom action buttons -->
      <div class="hypatia-campaign-actions">
        <button class="hypatia-btn hypatia-btn-primary hypatia-btn-lg" id="hypatia-continue-campaign">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Continue to Find Leads
        </button>
      </div>
    </div>
  `;
}

// =============================================================================
// LEADS STEP
// =============================================================================

function getLeadsStep() {
  const campaign = selectedCampaign || getDummyCampaigns()[0];
  const leads = currentLeads.length > 0 ? currentLeads : [];
  const hasLeads = leads.length > 0;

  let leadsListHtml = '';
  if (hasLeads) {
    leadsListHtml = `
      <div class="hypatia-leads-list">
        ${leads.map((lead, idx) => `
          <div class="hypatia-lead-row" data-lead-idx="${idx}">
            <label class="hypatia-lead-checkbox">
              <input type="checkbox" class="hypatia-lead-check" data-idx="${idx}" checked />
            </label>
            <div class="hypatia-lead-avatar">
              ${lead.name ? lead.name.charAt(0).toUpperCase() : '?'}
            </div>
            <div class="hypatia-lead-info">
              <div class="hypatia-lead-name">${escapeHtml(lead.name || 'Unknown')}</div>
              <div class="hypatia-lead-email">${escapeHtml(lead.email || 'No email')}</div>
            </div>
            <div class="hypatia-lead-meta">
              ${lead.title ? `<span class="hypatia-lead-title">${escapeHtml(lead.title)}</span>` : ''}
              ${lead.company ? `<span class="hypatia-lead-company">${escapeHtml(lead.company)}</span>` : ''}
            </div>
            <div class="hypatia-lead-actions">
              <button class="hypatia-btn-icon hypatia-btn-remove" data-idx="${idx}" title="Remove">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    leadsListHtml = `
      <div class="hypatia-leads-empty">
        <div class="hypatia-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <h4 class="hypatia-empty-title">No leads yet</h4>
        <p class="hypatia-empty-desc">Use the search above to generate leads based on your criteria</p>
      </div>
    `;
  }

  return `
    <div class="hypatia-step hypatia-leads-screen">
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-to-campaign">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>Back to Campaign</span>
        </button>
      </div>

      <div class="hypatia-leads-hero">
        <div class="hypatia-page-badge">Leads</div>
        <h1 class="hypatia-page-title">Generate Leads</h1>
        <p class="hypatia-page-subtitle">
          Find people to contact for: <strong>${escapeHtml(campaign.representative_subject || 'this campaign')}</strong>
        </p>
      </div>

      <div class="hypatia-leads-input-section">
        <label class="hypatia-input-label">Describe who you want to contact</label>
        <div class="hypatia-leads-input-wrapper">
          <textarea
            class="hypatia-leads-textarea"
            id="hypatia-leads-query"
            placeholder="e.g., Find me 50 CTOs at YC-backed startups in San Francisco..."
            rows="3"
          ></textarea>
          <button class="hypatia-btn hypatia-btn-generate" id="hypatia-generate-leads">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            Generate Leads
          </button>
        </div>
        <p class="hypatia-input-hint">Be specific about role, company type, location, or any other criteria</p>
      </div>

      <div class="hypatia-leads-suggestions">
        <span class="hypatia-suggestions-label">Quick suggestions:</span>
        <div class="hypatia-suggestion-chips">
          <button class="hypatia-chip" data-query="50 startup founders in my network">Startup founders</button>
          <button class="hypatia-chip" data-query="Marketing managers at SaaS companies">Marketing managers</button>
          <button class="hypatia-chip" data-query="VCs and angel investors">Investors</button>
          <button class="hypatia-chip" data-query="Engineering leads at tech companies">Engineering leads</button>
        </div>
      </div>

      <div class="hypatia-leads-section">
        <div class="hypatia-leads-header">
          <h3 class="hypatia-section-title">${hasLeads ? `Generated Leads (${leads.length})` : 'Your Leads'}</h3>
          ${hasLeads ? `
            <div class="hypatia-leads-actions">
              <button class="hypatia-btn-icon" id="hypatia-select-all" title="Select all">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 11 12 14 22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </button>
            </div>
          ` : ''}
        </div>
        ${leadsListHtml}
      </div>

      ${hasLeads ? `
        <div class="hypatia-leads-footer">
          <div class="hypatia-leads-selected-count">
            <span id="hypatia-selected-count">${leads.length}</span> of ${leads.length} selected
          </div>
          <button class="hypatia-btn hypatia-btn-primary" id="hypatia-continue-to-template">
            Continue to Template
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

// =============================================================================
// TEMPLATE STEP
// =============================================================================

function getTemplateStep() {
  const campaign = selectedCampaign || getDummyCampaigns()[0];
  const leads = currentLeads.length > 0 ? currentLeads : getDummyLeads();
  const previewLead = leads[0] || { name: 'John Doe', email: 'john@example.com', company: 'Acme Inc', title: 'CEO' };

  // Generate default template if not set
  if (!currentTemplate.subject) {
    currentTemplate.subject = 'Quick question, {{first_name}}';
    currentTemplate.body = `Hi {{first_name}},

I wanted to reach out regarding ${campaign.cta_description || 'a potential opportunity'}.

${campaign.style_description && campaign.style_description.toLowerCase().includes('casual')
  ? 'Would love to chat if you have a few minutes this week.'
  : 'I would appreciate the opportunity to discuss this further at your convenience.'}

Best,
[Your name]`;
  }

  const previewSubject = replaceTemplateVariables(currentTemplate.subject, previewLead);
  const previewBody = replaceTemplateVariables(currentTemplate.body, previewLead);

  return `
    <div class="hypatia-step hypatia-template-screen">
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-to-campaign">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>Back to Campaign</span>
        </button>
      </div>

      <div class="hypatia-template-hero">
        <div class="hypatia-page-badge">Template</div>
        <h1 class="hypatia-page-title">Email Template</h1>
        <p class="hypatia-page-subtitle">
          Customize your email for: <strong>${escapeHtml(campaign.representative_subject || 'this campaign')}</strong>
        </p>
      </div>

      <div class="hypatia-template-container">
        <div class="hypatia-template-editor">
          <h3 class="hypatia-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit Template
          </h3>

          <div class="hypatia-template-field">
            <label class="hypatia-input-label">Subject Line</label>
            <input type="text" class="hypatia-input hypatia-template-subject" id="hypatia-template-subject" value="${escapeHtml(currentTemplate.subject)}" placeholder="Enter email subject..." />
          </div>

          <div class="hypatia-template-field">
            <label class="hypatia-input-label">Email Body</label>
            <textarea class="hypatia-textarea hypatia-template-body" id="hypatia-template-body" rows="12" placeholder="Write your email here...">${escapeHtml(currentTemplate.body)}</textarea>
          </div>

          <div class="hypatia-variables-help">
            <span class="hypatia-variables-label">Available variables:</span>
            <div class="hypatia-variable-chips">
              <button class="hypatia-variable-chip" data-var="{{first_name}}">{{first_name}}</button>
              <button class="hypatia-variable-chip" data-var="{{last_name}}">{{last_name}}</button>
              <button class="hypatia-variable-chip" data-var="{{company}}">{{company}}</button>
              <button class="hypatia-variable-chip" data-var="{{title}}">{{title}}</button>
            </div>
            <p class="hypatia-variables-hint">Click to insert at cursor position</p>
          </div>

          ${campaign.style_description ? `
            <div class="hypatia-style-info">
              <div class="hypatia-style-info-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
              </div>
              <div class="hypatia-style-info-text">
                <strong>Your writing style:</strong> ${escapeHtml(campaign.style_description)}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="hypatia-template-preview">
          <div class="hypatia-preview-header">
            <h3 class="hypatia-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Live Preview
            </h3>
          </div>

          <div class="hypatia-email-preview">
            <div class="hypatia-email-preview-header">
              <div class="hypatia-email-to">
                <span class="hypatia-email-label">To:</span>
                <span class="hypatia-email-value">${escapeHtml(previewLead.name)} &lt;${escapeHtml(previewLead.email)}&gt;</span>
              </div>
              <div class="hypatia-email-subject">
                <span class="hypatia-email-label">Subject:</span>
                <span class="hypatia-email-value" id="hypatia-preview-subject">${escapeHtml(previewSubject)}</span>
              </div>
            </div>
            <div class="hypatia-email-preview-body" id="hypatia-preview-body">
              ${escapeHtml(previewBody).replace(/\n/g, '<br>')}
            </div>
          </div>

          <div class="hypatia-preview-lead-info">
            <div class="hypatia-preview-lead-avatar">${previewLead.name ? previewLead.name.charAt(0).toUpperCase() : '?'}</div>
            <div class="hypatia-preview-lead-details">
              <div class="hypatia-preview-lead-name">${escapeHtml(previewLead.name)}</div>
              <div class="hypatia-preview-lead-meta">${previewLead.title ? escapeHtml(previewLead.title) + ' at ' : ''}${escapeHtml(previewLead.company || '')}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="hypatia-template-footer">
        <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-back-to-leads-btn">
          Back to Leads
        </button>
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-save-and-send">
          Save & Review Sending
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function replaceTemplateVariables(text, lead) {
  if (!text || !lead) return text;
  let firstName = lead.first_name || '';
  let lastName = lead.last_name || '';
  if (!firstName && lead.name) {
    const parts = lead.name.split(' ');
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }
  return text
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi, lastName)
    .replace(/\{\{name\}\}/gi, lead.name || '')
    .replace(/\{\{company\}\}/gi, lead.company || '')
    .replace(/\{\{title\}\}/gi, lead.title || '')
    .replace(/\{\{email\}\}/gi, lead.email || '');
}

// =============================================================================
// SENT STEP
// =============================================================================

function getSentStep() {
  const campaign = selectedCampaign || getDummyCampaigns()[0];
  const sentEmails = campaign.sent_emails?.length > 0 ? campaign.sent_emails : getDummySentEmails();

  const stats = {
    total: sentEmails.length,
    delivered: sentEmails.filter(e => e.status !== 'bounced').length,
    opened: sentEmails.filter(e => e.opened_at || e.status === 'opened' || e.status === 'replied').length,
    replied: sentEmails.filter(e => e.status === 'replied').length,
    bounced: sentEmails.filter(e => e.status === 'bounced').length
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'delivered':
        return `<div class="hypatia-status-icon hypatia-status-delivered" title="Delivered"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>`;
      case 'opened':
        return `<div class="hypatia-status-icon hypatia-status-opened" title="Opened"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>`;
      case 'replied':
        return `<div class="hypatia-status-icon hypatia-status-replied" title="Replied"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></div>`;
      case 'bounced':
        return `<div class="hypatia-status-icon hypatia-status-bounced" title="Bounced"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>`;
      default:
        return `<div class="hypatia-status-icon hypatia-status-pending" title="Pending"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>`;
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return `
    <div class="hypatia-step hypatia-sent-screen">
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-to-campaign">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>Back to Campaign</span>
        </button>
      </div>

      <div class="hypatia-sent-hero">
        <div class="hypatia-page-badge">Tracking</div>
        <h1 class="hypatia-page-title">Sent Emails</h1>
        <p class="hypatia-page-subtitle">
          Tracking emails for: <strong>${escapeHtml(campaign.representative_subject || 'this campaign')}</strong>
        </p>
      </div>

      <div class="hypatia-sent-stats">
        <div class="hypatia-sent-stat-card">
          <div class="hypatia-sent-stat-icon hypatia-icon-total">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </div>
          <div class="hypatia-sent-stat-content">
            <div class="hypatia-sent-stat-value">${stats.total}</div>
            <div class="hypatia-sent-stat-label">Total Sent</div>
          </div>
        </div>
        <div class="hypatia-sent-stat-card">
          <div class="hypatia-sent-stat-icon hypatia-icon-delivered">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div class="hypatia-sent-stat-content">
            <div class="hypatia-sent-stat-value">${stats.delivered}</div>
            <div class="hypatia-sent-stat-label">Delivered</div>
          </div>
        </div>
        <div class="hypatia-sent-stat-card">
          <div class="hypatia-sent-stat-icon hypatia-icon-opened">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <div class="hypatia-sent-stat-content">
            <div class="hypatia-sent-stat-value">${stats.opened}</div>
            <div class="hypatia-sent-stat-label">Opened</div>
            <div class="hypatia-sent-stat-rate">${stats.total > 0 ? Math.round((stats.opened / stats.total) * 100) : 0}%</div>
          </div>
        </div>
        <div class="hypatia-sent-stat-card">
          <div class="hypatia-sent-stat-icon hypatia-icon-replied">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 17 4 12 9 7"/>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
            </svg>
          </div>
          <div class="hypatia-sent-stat-content">
            <div class="hypatia-sent-stat-value">${stats.replied}</div>
            <div class="hypatia-sent-stat-label">Replied</div>
            <div class="hypatia-sent-stat-rate">${stats.total > 0 ? Math.round((stats.replied / stats.total) * 100) : 0}%</div>
          </div>
        </div>
        <div class="hypatia-sent-stat-card">
          <div class="hypatia-sent-stat-icon hypatia-icon-bounced">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div class="hypatia-sent-stat-content">
            <div class="hypatia-sent-stat-value">${stats.bounced}</div>
            <div class="hypatia-sent-stat-label">Bounced</div>
          </div>
        </div>
      </div>

      <div class="hypatia-sent-list-container">
        <div class="hypatia-sent-list">
          ${sentEmails.map((email, idx) => `
            <div class="hypatia-sent-row" data-email-idx="${idx}">
              <div class="hypatia-sent-status">
                ${getStatusIcon(email.status)}
              </div>
              <div class="hypatia-sent-recipient">
                <div class="hypatia-sent-recipient-avatar">
                  ${email.recipient_name ? email.recipient_name.charAt(0).toUpperCase() : '?'}
                </div>
                <div class="hypatia-sent-recipient-info">
                  <div class="hypatia-sent-recipient-name">${escapeHtml(email.recipient_name || 'Unknown')}</div>
                  <div class="hypatia-sent-recipient-email">${escapeHtml(email.recipient_email || '')}</div>
                </div>
              </div>
              <div class="hypatia-sent-subject">${escapeHtml(email.subject || 'No subject')}</div>
              <div class="hypatia-sent-meta">
                <div class="hypatia-sent-date">${formatDate(email.sent_at)}</div>
                ${email.opened_at ? `<div class="hypatia-sent-opened">Opened ${formatDate(email.opened_at)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
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
// DASHBOARD STEP
// =============================================================================

function getDashboardStep() {
  return `
    <div class="hypatia-step hypatia-dashboard">
      <div class="hypatia-dashboard-header">
        <h2 class="hypatia-title">Dashboard</h2>
        <p class="hypatia-subtitle">Manage your account and settings</p>
      </div>

      <div class="hypatia-dashboard-content">
        <div class="hypatia-dashboard-section">
          <h3 class="hypatia-section-title">Account</h3>
          <div class="hypatia-account-card" id="hypatia-account-info">
            <div class="hypatia-spinner-container">
              <div class="hypatia-spinner"></div>
            </div>
          </div>
        </div>

        <div class="hypatia-dashboard-section">
          <h3 class="hypatia-section-title">Quick Stats</h3>
          <div class="hypatia-stats-grid" id="hypatia-stats-grid">
            <div class="hypatia-stat-card">
              <div class="hypatia-stat-value">-</div>
              <div class="hypatia-stat-label">Campaigns</div>
            </div>
            <div class="hypatia-stat-card">
              <div class="hypatia-stat-value">-</div>
              <div class="hypatia-stat-label">Emails Analyzed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadDashboardData() {
  const status = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
  });

  const accountInfo = document.getElementById('hypatia-account-info');
  if (!accountInfo) return;

  if (status && status.complete) {
    accountInfo.innerHTML = `
      <div class="hypatia-account-row">
        <span class="hypatia-account-label">Email</span>
        <span class="hypatia-account-value">${escapeHtml(status.email || 'Unknown')}</span>
      </div>
      <div class="hypatia-account-row">
        <span class="hypatia-account-label">Status</span>
        <span class="hypatia-account-value hypatia-status-active">Active</span>
      </div>
      <div class="hypatia-account-actions">
        <button class="hypatia-btn hypatia-btn-danger" id="hypatia-dashboard-signout">
          Sign Out
        </button>
      </div>
    `;

    // Attach sign out handler
    document.getElementById('hypatia-dashboard-signout')?.addEventListener('click', handleSignOut);
  } else {
    accountInfo.innerHTML = `
      <div class="hypatia-not-signed-in">
        <p>You are not signed in.</p>
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-dashboard-signin">
          Sign In to Hypatia
        </button>
      </div>
    `;

    document.getElementById('hypatia-dashboard-signin')?.addEventListener('click', () => {
      currentStep = 'welcome';
      updatePanelContent();
    });
  }

  // Load stats
  const statsGrid = document.getElementById('hypatia-stats-grid');
  if (statsGrid && campaignsData.length > 0) {
    const totalCampaigns = campaignsData.length;
    const totalEmails = campaignsData.reduce((sum, c) => sum + (c.email_count || 0), 0);

    statsGrid.innerHTML = `
      <div class="hypatia-stat-card">
        <div class="hypatia-stat-value">${totalCampaigns}</div>
        <div class="hypatia-stat-label">Campaigns</div>
      </div>
      <div class="hypatia-stat-card">
        <div class="hypatia-stat-value">${totalEmails}</div>
        <div class="hypatia-stat-label">Emails Analyzed</div>
      </div>
    `;
  }
}

async function handleSignOut() {
  // Confirm sign out
  const confirmed = confirm('Are you sure you want to sign out of Hypatia? This will clear all cached data and you will need to re-authenticate.');
  if (!confirmed) return;

  // Call background script to handle sign out
  const response = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'signOut' }, resolve);
  });

  if (response && response.success) {
    // Reset local state
    currentUserId = null;
    campaignsData = [];
    selectedCampaign = null;
    currentStep = 'welcome';
    questionnaireState = {
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
    backendState = {
      isComplete: false,
      emailCount: 0,
      campaignsCreated: 0,
      campaigns: []
    };

    // Update sidebar auth section
    updateSidebarAuthState(false);

    // Update header button state
    updateButtonState(false);

    // Navigate away and close panel
    navigateBack();

    console.log('[Hypatia] Sign out complete');
  } else {
    alert('Sign out failed. Please try again.');
  }
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
  console.log('[Hypatia] updatePanelContent() called, currentStep:', currentStep);
  const content = document.querySelector('.hypatia-panel-content');
  if (content) {
    content.innerHTML = getStepContent();
    // Use full-width layout for campaigns and campaign_detail views
    if (currentStep === 'campaigns' || currentStep === 'campaign_detail') {
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

  // Campaign card clicks
  const campaignCards = document.querySelectorAll('.hypatia-campaign-card');
  campaignCards.forEach(card => {
    card.addEventListener('click', () => {
      stopEmailCycling(); // Stop cycling when clicking a card
      const campaignId = card.dataset.campaignId;
      handleCampaignCardClick(campaignId);
    });
  });

  // Start email cycling animation if on campaigns view
  if (campaignCards.length > 0) {
    startEmailCycling();
  }

  // Add New Campaign button
  const addCampaignBtn = document.getElementById('hypatia-add-campaign-btn');
  if (addCampaignBtn) {
    addCampaignBtn.addEventListener('click', handleAddNewCampaign);
  }

  // Close button in campaigns view
  const campaignsCloseBtn = document.getElementById('hypatia-campaigns-close-btn');
  if (campaignsCloseBtn) {
    campaignsCloseBtn.addEventListener('click', navigateBack);
  }

  // Pagination buttons
  const prevPageBtn = document.getElementById('hypatia-prev-page');
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', handlePrevPage);
  }

  const nextPageBtn = document.getElementById('hypatia-next-page');
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', handleNextPage);
  }

  // Back to campaigns button
  const backToCampaignsBtn = document.getElementById('hypatia-back-to-campaigns');
  if (backToCampaignsBtn) {
    backToCampaignsBtn.addEventListener('click', handleBackToCampaigns);
  }

  // Continue Campaign button
  const continueCampaignBtn = document.getElementById('hypatia-continue-campaign');
  if (continueCampaignBtn) {
    continueCampaignBtn.addEventListener('click', handleContinueCampaign);
  }

  // Back to campaign detail button
  const backToCampaignBtn = document.getElementById('hypatia-back-to-campaign');
  if (backToCampaignBtn) {
    backToCampaignBtn.addEventListener('click', handleBackToCampaignDetail);
  }

  // Campaign detail action cards
  const gotoLeadsBtn = document.getElementById('hypatia-goto-leads');
  if (gotoLeadsBtn) {
    gotoLeadsBtn.addEventListener('click', handleGotoLeads);
  }

  const gotoTemplateBtn = document.getElementById('hypatia-goto-template');
  if (gotoTemplateBtn) {
    gotoTemplateBtn.addEventListener('click', handleGotoTemplate);
  }

  const gotoSentBtn = document.getElementById('hypatia-goto-sent');
  if (gotoSentBtn) {
    gotoSentBtn.addEventListener('click', handleGotoSent);
  }

  // Find People button (new main CTA on campaign detail)
  const findPeopleBtn = document.getElementById('hypatia-find-people-btn');
  if (findPeopleBtn) {
    findPeopleBtn.addEventListener('click', handleGotoLeads);
  }

  // Auto-save CTA and Contact fields on blur
  const ctaInput = document.getElementById('hypatia-cta-input');
  if (ctaInput) {
    ctaInput.addEventListener('blur', () => saveCampaignField('cta_description', ctaInput.value));
  }
  const contactInput = document.getElementById('hypatia-contact-input');
  if (contactInput) {
    contactInput.addEventListener('blur', () => saveCampaignField('contact_description', contactInput.value));
  }

  // Leads screen handlers
  const generateLeadsBtn = document.getElementById('hypatia-generate-leads');
  if (generateLeadsBtn) {
    generateLeadsBtn.addEventListener('click', handleGenerateLeads);
  }

  const continueToTemplateBtn = document.getElementById('hypatia-continue-to-template');
  if (continueToTemplateBtn) {
    continueToTemplateBtn.addEventListener('click', handleGotoTemplate);
  }

  // Suggestion chips
  const chips = document.querySelectorAll('.hypatia-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.dataset.query;
      const textarea = document.getElementById('hypatia-leads-query');
      if (textarea) {
        textarea.value = query;
        textarea.focus();
      }
    });
  });

  // Template screen handlers
  const backToLeadsBtn = document.getElementById('hypatia-back-to-leads-btn');
  if (backToLeadsBtn) {
    backToLeadsBtn.addEventListener('click', handleGotoLeads);
  }

  const saveAndSendBtn = document.getElementById('hypatia-save-and-send');
  if (saveAndSendBtn) {
    saveAndSendBtn.addEventListener('click', handleSaveAndSend);
  }

  // Variable chips
  const variableChips = document.querySelectorAll('.hypatia-variable-chip');
  variableChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const variable = chip.dataset.var;
      insertVariableAtCursor(variable);
    });
  });

  // Live preview updates
  const templateSubject = document.getElementById('hypatia-template-subject');
  const templateBody = document.getElementById('hypatia-template-body');
  if (templateSubject) {
    templateSubject.addEventListener('input', updateTemplatePreview);
  }
  if (templateBody) {
    templateBody.addEventListener('input', updateTemplatePreview);
  }

  // Dashboard: load data when dashboard step is shown
  if (currentStep === 'dashboard') {
    loadDashboardData();
  }
}

function handleViewCampaigns() {
  currentStep = 'campaigns';
  updatePanelContent();
}

async function handleStartOnboarding() {
  // First check if already signed in and onboarded
  const status = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
  });

  if (status && status.complete && status.userId) {
    // Already completed - skip to campaigns
    console.log('[Hypatia] Already onboarded, skipping to campaigns...');
    currentUserId = status.userId;

    const campaignsResponse = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getCampaigns', userId: status.userId }, resolve);
    });

    if (campaignsResponse && campaignsResponse.success && campaignsResponse.campaigns) {
      campaignsData = campaignsResponse.campaigns;
    }

    currentStep = 'campaigns';
    updatePanelContent();
    return;
  }

  // Show signing in state first - questionnaire will show after auth completes
  currentStep = 'signing_in';
  questionnaireState.currentQuestion = 0;
  questionnaireState.isComplete = false;
  backendState.isComplete = false;
  updatePanelContent();

  // Send message to background script to start the process
  // The questionnaire will be shown when we receive 'questionnaire_start' from background
  chrome.runtime.sendMessage({ action: 'startOnboarding' });
}

function handleDone() {
  hideOnboardingPanel();
  updateButtonState(true);
}

// =============================================================================
// CAMPAIGN NAVIGATION HANDLERS
// =============================================================================

function handleCampaignCardClick(campaignId) {
  // Find the campaign from data or use dummy data
  let campaign;
  if (campaignsData.length > 0) {
    campaign = campaignsData.find(c => String(c.id) === String(campaignId)) || campaignsData[parseInt(campaignId)];
  }
  if (!campaign) {
    const dummyCampaigns = getDummyCampaigns();
    campaign = dummyCampaigns.find(c => String(c.id) === String(campaignId)) || dummyCampaigns[parseInt(campaignId)] || dummyCampaigns[0];
  }
  selectedCampaign = campaign;
  currentLeads = campaign.leads || [];
  currentTemplate = campaign.template || { subject: '', body: '' };
  currentStep = 'campaign_detail';

  // Update content directly without fade effect
  updatePanelContent();

  // Update URL silently (without triggering hash change handler to re-render)
  history.replaceState(null, '', `#${HYPATIA_CAMPAIGN_HASH_PREFIX}${campaignId}`);
}

function handlePrevPage() {
  if (currentCampaignsPage > 1) {
    currentCampaignsPage--;
    refreshCampaignsView();
  }
}

function handleNextPage() {
  const allCampaigns = campaignsData.length > 0 ? campaignsData : getDummyCampaigns();
  const totalPages = Math.ceil(allCampaigns.length / CAMPAIGNS_PER_PAGE);
  if (currentCampaignsPage < totalPages) {
    currentCampaignsPage++;
    refreshCampaignsView();
  }
}

function refreshCampaignsView() {
  const panelContent = document.querySelector('.hypatia-panel-content');
  if (panelContent) {
    panelContent.innerHTML = getCampaignsStep();
    attachEventListeners();
  }
}

function handleAddNewCampaign() {
  // Create a new blank campaign
  selectedCampaign = {
    id: 'new_' + Date.now(),
    representative_subject: 'New Campaign',
    representative_recipient: '',
    email_count: 0,
    avg_similarity: null,
    contact_description: '',
    style_description: 'Professional and friendly',
    cta_type: '',
    cta_description: '',
    cta_urgency: null,
    leads: [],
    sent_emails: [],
    template: null
  };
  currentLeads = [];
  currentTemplate = { subject: '', body: '' };
  currentStep = 'campaign_detail';
  updatePanelContent();
}

function handleBackToCampaigns() {
  selectedCampaign = null;
  currentStep = 'campaigns';

  // Update content directly without fade effect
  updatePanelContent();

  // Update URL silently
  history.replaceState(null, '', `#${HYPATIA_HASH}`);
}

function handleBackToCampaignDetail() {
  currentStep = 'campaign_detail';
  updatePanelContent();
}

async function saveCampaignField(fieldName, value) {
  if (!selectedCampaign || !selectedCampaign.id) return;

  // Update local state
  selectedCampaign[fieldName] = value;

  // Skip Supabase save for new campaigns (not yet persisted)
  if (selectedCampaign.id.toString().startsWith('new_')) {
    console.log('[Hypatia] Skipping save for new campaign (not yet persisted)');
    return;
  }

  // Save to Supabase
  console.log('[Hypatia] Auto-saving field:', fieldName, 'for campaign:', selectedCampaign.id);
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'updateCampaign',
      campaignId: selectedCampaign.id,
      fields: { [fieldName]: value }
    });
    if (response.success) {
      console.log('[Hypatia] Field saved successfully');
    } else {
      console.error('[Hypatia] Failed to save field:', response.error);
    }
  } catch (error) {
    console.error('[Hypatia] Error saving field:', error);
  }
}

async function handleContinueCampaign() {
  // Save all edited campaign values
  const ctaInput = document.getElementById('hypatia-cta-input');
  const contactInput = document.getElementById('hypatia-contact-input');

  if (selectedCampaign) {
    const fields = {};

    if (ctaInput) {
      selectedCampaign.cta_description = ctaInput.value;
      fields.cta_description = ctaInput.value;
    }
    if (contactInput) {
      selectedCampaign.contact_description = contactInput.value;
      fields.contact_description = contactInput.value;
    }

    // Save to Supabase (skip for new campaigns not yet persisted)
    if (Object.keys(fields).length > 0 && selectedCampaign.id && !selectedCampaign.id.toString().startsWith('new_')) {
      console.log('[Hypatia] Saving campaign to Supabase:', selectedCampaign.id, fields);
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'updateCampaign',
          campaignId: selectedCampaign.id,
          fields: fields
        });
        if (response.success) {
          console.log('[Hypatia] Campaign saved successfully');
        } else {
          console.error('[Hypatia] Failed to save campaign:', response.error);
        }
      } catch (error) {
        console.error('[Hypatia] Error saving campaign:', error);
      }
    }
  }

  // Navigate to leads step
  currentStep = 'leads';
  updatePanelContent();
}

function handleGotoLeads() {
  currentStep = 'leads';
  updatePanelContent();
}

function handleGotoTemplate() {
  currentStep = 'template';
  updatePanelContent();
}

function handleGotoSent() {
  currentStep = 'sent';
  updatePanelContent();
}

function handleGenerateLeads() {
  const query = document.getElementById('hypatia-leads-query')?.value?.trim();
  if (!query) {
    return;
  }

  // For now, simulate generating leads with dummy data
  currentLeads = getDummyLeads();

  // Update the campaign's leads
  if (selectedCampaign) {
    selectedCampaign.leads = currentLeads;
  }

  // Re-render to show the leads
  updatePanelContent();
}

function handleSaveAndSend() {
  // Save the template
  const subjectInput = document.getElementById('hypatia-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body');

  currentTemplate.subject = subjectInput?.value || '';
  currentTemplate.body = bodyInput?.value || '';

  if (selectedCampaign) {
    selectedCampaign.template = { ...currentTemplate };
  }

  // Go to sent screen (simulating that emails were sent)
  if (selectedCampaign && currentLeads.length > 0) {
    // Simulate sent emails
    selectedCampaign.sent_emails = currentLeads.map(lead => ({
      recipient_name: lead.name,
      recipient_email: lead.email,
      subject: replaceTemplateVariables(currentTemplate.subject, lead),
      status: 'delivered',
      sent_at: new Date().toISOString(),
      body: replaceTemplateVariables(currentTemplate.body, lead)
    }));
  }

  currentStep = 'sent';
  updatePanelContent();
}

function insertVariableAtCursor(variable) {
  const bodyInput = document.getElementById('hypatia-template-body');
  if (!bodyInput) return;

  const start = bodyInput.selectionStart;
  const end = bodyInput.selectionEnd;
  const text = bodyInput.value;

  bodyInput.value = text.substring(0, start) + variable + text.substring(end);
  bodyInput.selectionStart = bodyInput.selectionEnd = start + variable.length;
  bodyInput.focus();

  updateTemplatePreview();
}

function updateTemplatePreview() {
  const subjectInput = document.getElementById('hypatia-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body');
  const previewSubject = document.getElementById('hypatia-preview-subject');
  const previewBody = document.getElementById('hypatia-preview-body');

  currentTemplate.subject = subjectInput?.value || '';
  currentTemplate.body = bodyInput?.value || '';

  const leads = currentLeads.length > 0 ? currentLeads : getDummyLeads();
  const previewLead = leads[0] || { name: 'John Doe', email: 'john@example.com', company: 'Acme Inc', title: 'CEO' };

  if (previewSubject) {
    previewSubject.textContent = replaceTemplateVariables(currentTemplate.subject, previewLead);
  }

  if (previewBody) {
    previewBody.innerHTML = escapeHtml(replaceTemplateVariables(currentTemplate.body, previewLead)).replace(/\n/g, '<br>');
  }
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
      // Update signing in status (new flow) or progress status (legacy)
      const signinStatus = document.getElementById('hypatia-signin-status');
      if (signinStatus) signinStatus.textContent = data.message;
      const statusAuth = document.getElementById('hypatia-status-message');
      if (statusAuth) statusAuth.textContent = data.message;
      break;

    case 'setup':
      progressData.message = data.message;
      // Update signing in status (new flow) or progress status (legacy)
      const signinStatusSetup = document.getElementById('hypatia-signin-status');
      if (signinStatusSetup) signinStatusSetup.textContent = data.message;
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
// GMAIL LEFT SIDEBAR INJECTION
// =============================================================================

function findGmailSidebar() {
  // Primary selector based on user-provided class
  const sidebar = document.querySelector('.V3.aam');
  if (sidebar) {
    console.log('[Hypatia] Found sidebar with .V3.aam selector');
    return sidebar;
  }

  // Fallback selectors
  const fallbacks = ['.aeN', '[role="navigation"] .TK', '.byl'];
  for (const selector of fallbacks) {
    const el = document.querySelector(selector);
    if (el) {
      console.log('[Hypatia] Found sidebar with fallback selector:', selector);
      return el;
    }
  }

  return null;
}

async function injectHypatiaSidebar() {
  if (sidebarInjected || document.getElementById(HYPATIA_SIDEBAR_ID)) {
    return;
  }

  const sidebar = findGmailSidebar();
  if (!sidebar) {
    console.log('[Hypatia] Sidebar not found, will retry...');
    return;
  }

  // Check auth state to determine Sign In / Sign Out display
  const status = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
  });
  const isSignedIn = status && status.complete;
  const userEmail = status?.email || null;

  // Check if sidebar collapsed state is saved
  const storageData = await chrome.storage.local.get(['hypatia_sidebar_collapsed']);
  const isCollapsed = storageData.hypatia_sidebar_collapsed || false;

  // Create the Hypatia sidebar section
  const hypatiaSection = document.createElement('div');
  hypatiaSection.className = `hypatia-sidebar-section${isCollapsed ? ' collapsed' : ''}`;
  hypatiaSection.id = HYPATIA_SIDEBAR_ID;
  hypatiaSection.innerHTML = getSidebarHTML(isSignedIn, userEmail);

  // Insert at the end of the sidebar
  sidebar.appendChild(hypatiaSection);

  sidebarInjected = true;
  console.log('[Hypatia] Sidebar section injected');

  // Attach event listeners
  attachSidebarEventListeners();

  // Update active state based on current hash
  updateSidebarActiveState();
}

function getSidebarHTML(isSignedIn, userEmail) {
  const authContent = isSignedIn
    ? `
      ${userEmail ? `<div class="hypatia-user-info">${escapeHtml(userEmail)}</div>` : ''}
      <button class="hypatia-auth-btn signout" id="hypatia-sidebar-signout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign Out
      </button>
    `
    : `
      <button class="hypatia-auth-btn signin" id="hypatia-sidebar-signin">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Sign In
      </button>
    `;

  return `
    <div class="hypatia-sidebar-header" id="hypatia-sidebar-toggle">
      <div class="hypatia-sidebar-arrow">
        <svg class="hypatia-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="hypatia-sidebar-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
        </svg>
      </div>
      <span class="hypatia-sidebar-label">Hypatia</span>
    </div>
    <div class="hypatia-sidebar-content" id="hypatia-sidebar-content">
      <div class="hypatia-sidebar-item" data-tab="campaigns">
        <span class="hypatia-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
          </svg>
        </span>
        <span class="hypatia-item-label">Campaigns</span>
      </div>
      <div class="hypatia-sidebar-item" data-tab="dashboard">
        <span class="hypatia-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
        </span>
        <span class="hypatia-item-label">Dashboard</span>
      </div>
      <div class="hypatia-sidebar-divider"></div>
      <div class="hypatia-sidebar-auth" id="hypatia-sidebar-auth">
        ${authContent}
      </div>
    </div>
  `;
}

function attachSidebarEventListeners() {
  // Toggle collapse/expand
  const toggleBtn = document.getElementById('hypatia-sidebar-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSidebarCollapse);
  }

  // Sidebar navigation items
  const sidebarItems = document.querySelectorAll('.hypatia-sidebar-item');
  sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      handleSidebarNavigation(tab);
    });
  });

  // Sign Out button in sidebar
  const signOutBtn = document.getElementById('hypatia-sidebar-signout');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', handleSignOut);
  }

  // Sign In button in sidebar
  const signInBtn = document.getElementById('hypatia-sidebar-signin');
  if (signInBtn) {
    signInBtn.addEventListener('click', () => {
      navigateToHypatia();
    });
  }
}

function toggleSidebarCollapse() {
  const section = document.getElementById(HYPATIA_SIDEBAR_ID);
  if (section) {
    section.classList.toggle('collapsed');
    // Persist collapse state
    chrome.storage.local.set({
      hypatia_sidebar_collapsed: section.classList.contains('collapsed')
    });
  }
}

function handleSidebarNavigation(tab) {
  const hashMap = {
    'campaigns': '#hypatia',
    'dashboard': '#hypatia/dashboard'
  };

  if (!isHypatiaHash()) {
    previousHash = window.location.hash || '#inbox';
  }

  window.location.hash = hashMap[tab] || '#hypatia';
}

function updateSidebarActiveState() {
  const hash = window.location.hash.slice(1);
  const items = document.querySelectorAll('.hypatia-sidebar-item');

  items.forEach(item => {
    item.classList.remove('active');
    const tab = item.dataset.tab;

    if (
      (tab === 'campaigns' && (hash === 'hypatia' || hash.startsWith('hypatia/campaign/'))) ||
      (tab === 'dashboard' && hash === 'hypatia/dashboard')
    ) {
      item.classList.add('active');
    }
  });
}

function updateSidebarAuthState(isSignedIn, userEmail = null) {
  const authSection = document.getElementById('hypatia-sidebar-auth');
  if (!authSection) return;

  if (isSignedIn) {
    authSection.innerHTML = `
      ${userEmail ? `<div class="hypatia-user-info">${escapeHtml(userEmail)}</div>` : ''}
      <button class="hypatia-auth-btn signout" id="hypatia-sidebar-signout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign Out
      </button>
    `;
  } else {
    authSection.innerHTML = `
      <button class="hypatia-auth-btn signin" id="hypatia-sidebar-signin">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Sign In
      </button>
    `;
  }

  // Re-attach event listeners
  const signOutBtn = document.getElementById('hypatia-sidebar-signout');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', handleSignOut);
  }
  const signInBtn = document.getElementById('hypatia-sidebar-signin');
  if (signInBtn) {
    signInBtn.addEventListener('click', () => {
      navigateToHypatia();
    });
  }
}

function setupSidebarPersistence() {
  // Watch for Gmail re-renders that might remove our sidebar
  const observer = new MutationObserver(() => {
    if (!document.getElementById(HYPATIA_SIDEBAR_ID)) {
      sidebarInjected = false;
      injectHypatiaSidebar();
    }
  });

  // Observe the body for major DOM changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
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

  // Inject sidebar after Gmail loads (with longer delay to ensure sidebar is ready)
  setTimeout(() => {
    injectHypatiaSidebar();
    setupSidebarPersistence();
  }, 2500);

  // Retry sidebar injection periodically in case Gmail re-renders
  setInterval(() => {
    if (!document.getElementById(HYPATIA_SIDEBAR_ID)) {
      sidebarInjected = false;
      injectHypatiaSidebar();
    }
  }, 5000);

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
