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
const HYPATIA_LEADS_HASH = 'hypatia/leads';
const HYPATIA_TEMPLATES_HASH = 'hypatia/templates';
const HYPATIA_DASHBOARD_HASH = 'hypatia/dashboard';

// Store the previous hash to navigate back
let previousHash = '';

// =============================================================================
// STATE
// =============================================================================

let currentStep = 'welcome'; // welcome, progress, questionnaire, waiting, complete, error, campaigns, campaign_detail, leads, template, sent, generating
let progressData = { current: 0, total: 100 };
let isOnboardingVisible = false;
let lastButtonCheck = 0;
const BUTTON_CHECK_INTERVAL = 500; // ms - throttle for performance
let campaignsData = []; // Stores campaign groups after clustering
let currentUserId = null;
let selectedCampaign = null; // Currently selected campaign for detail view
let currentLeads = []; // Leads for the current campaign
let currentTemplate = { subject: '', body: '' }; // Current email template
let originalTemplate = { subject: '', body: '' }; // Original template before user edits (for tracking changes)
let clusteringAnimationInterval = null;
let currentCampaignsPage = 1; // Current page for campaigns pagination
const CAMPAIGNS_PER_PAGE = 6; // 3x2 grid
let sidebarInjected = false; // Track if sidebar has been injected

// Parallel generation state for leads + template + cadence
let parallelGenerationState = {
  isGenerating: false,
  leadsLoading: false,
  templateLoading: false,
  cadenceLoading: false,
  leadsResult: null,
  templateResult: null,
  cadenceResult: null,
  leadsError: null,
  templateError: null,
  cadenceError: null
};

// Current cadence timing (user-configurable)
let currentCadenceTiming = {
  day_1: 1,   // Initial outreach
  day_2: 3,   // Follow-up 1
  day_3: 7,   // Follow-up 2
  day_4: 14   // Follow-up 3
};

// Note: Shared state (userDisplayName, questionnaireState, backendState, QUESTIONNAIRE_QUESTIONS)
// is defined in onboarding.js which loads before this file per manifest.json

// Contact preference analysis state (Groq-powered)
let contactPreferenceAnalysis = {
  location: false,
  job_title: false,
  experience: false,
  education: false,
  industry: false,
  skills: false
};
let contactAnalysisDebounceTimer = null;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a UUID v4 for new campaigns (Supabase requires UUID format)
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Debounce function - delays execution until after wait ms have elapsed since last call
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Analyze contact preference text using Groq to detect categories
 */
async function analyzeContactPreference(text) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'analyzeContactPreference',
      text: text
    });

    if (response.success) {
      contactPreferenceAnalysis = response.categories;
      console.log('[Hypatia] Contact preference categories:', contactPreferenceAnalysis);
      updateContactPreferenceUI();
    }
  } catch (error) {
    console.warn('[Hypatia] Contact analysis error:', error);
  }
}

/**
 * Update UI to show which contact preference categories are detected
 */
function updateContactPreferenceUI() {
  const container = document.getElementById('hypatia-contact-categories');
  if (!container) return;

  const categories = [
    { key: 'location', label: 'Location' },
    { key: 'job_title', label: 'Job Title' },
    { key: 'experience', label: 'Experience' },
    { key: 'education', label: 'Education' },
    { key: 'industry', label: 'Industry' },
    { key: 'skills', label: 'Skills' }
  ];

  container.innerHTML = categories.map(cat => `
    <span class="hypatia-category-chip ${contactPreferenceAnalysis[cat.key] ? 'hypatia-category-active' : ''}">
      ${cat.label}
    </span>
  `).join('');
}

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
    // Mark the button's complete state as a data attribute
    btn.dataset.complete = isComplete ? 'true' : 'false';

    // Always use the blue H SVG logo
    btn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="#5f6368" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <text x="12" y="16.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="500" fill="#4285f4" stroke="none">H</text>
      </svg>
    `;

    if (isComplete) {
      btn.classList.add('hypatia-btn-complete');
    } else {
      btn.classList.remove('hypatia-btn-complete');
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

    // Also force visibility on the inner button, but preserve hover state
    const innerBtn = document.getElementById('hypatia-header-btn');
    if (innerBtn) {
      // Don't override background if button is being hovered (check via matches)
      const isHovered = innerBtn.matches(':hover');
      const background = isHovered ? 'rgba(0,0,0,0.06)' : 'transparent';
      innerBtn.setAttribute('style', `display:inline-flex!important;align-items:center!important;justify-content:center!important;visibility:visible!important;opacity:1!important;width:40px!important;height:40px!important;padding:0!important;background:${background}!important;border:none!important;border-radius:50%!important;cursor:pointer!important;line-height:1!important;`);
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
  return hash === HYPATIA_HASH ||
         hash.startsWith(HYPATIA_CAMPAIGN_HASH_PREFIX) ||
         hash === HYPATIA_LEADS_HASH ||
         hash === HYPATIA_TEMPLATES_HASH ||
         hash === HYPATIA_DASHBOARD_HASH;
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

async function handleHashChange() {
  console.log('[Hypatia] Hash changed to:', window.location.hash);
  const hash = window.location.hash.slice(1); // Remove the # prefix

  if (isHypatiaHash()) {
    // First check if user is onboarded before showing any view
    const status = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
    });

    const isOnboarded = status && status.complete && status.userId;

    if (!isOnboarded) {
      // User not onboarded - show welcome/onboarding flow
      currentStep = 'welcome';
      showOnboardingPanel();
      updateSidebarActiveState();
      return;
    }

    // User is onboarded - proceed to requested view
    currentUserId = status.userId;

    const campaignId = getCampaignIdFromHash();
    if (campaignId) {
      // Navigate directly to a specific campaign
      loadCampaignFromHash(campaignId);
    } else if (hash === HYPATIA_LEADS_HASH) {
      // Leads view
      currentStep = 'leads_list';
      showOnboardingPanel();
    } else if (hash === HYPATIA_TEMPLATES_HASH) {
      // Templates view
      currentStep = 'templates_list';
      showOnboardingPanel();
    } else if (hash === HYPATIA_DASHBOARD_HASH) {
      // Dashboard view
      currentStep = 'dashboard';
      showOnboardingPanel();
    } else {
      // Main campaigns view
      currentStep = 'campaigns';
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
    // Load saved AI-generated content in background
    loadSavedCampaignContent(campaignId);
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

      console.log('[Hypatia] getCampaigns response:', campaignsResponse);

      if (campaignsResponse && campaignsResponse.success && campaignsResponse.campaigns) {
        campaignsData = campaignsResponse.campaigns;
        console.log('[Hypatia] Loaded campaigns:', campaignsData.length);
      } else {
        console.error('[Hypatia] Failed to load campaigns:', campaignsResponse?.error || 'Unknown error');
      }

      currentStep = 'campaigns';
    }
  }

  // Fetch campaigns if needed for any step that displays campaign data.
  // Do this whenever we need campaigns and don't have them yet, regardless of whether currentUserId is already set.
  const needsCampaigns = ['campaigns', 'campaign_detail', 'leads', 'leads_list', 'template', 'templates_list', 'dashboard'].includes(currentStep);
  if (needsCampaigns && campaignsData.length === 0) {
    // Get userId from onboarding status if not already set
    if (!currentUserId) {
      const status = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
      });
      currentUserId = status?.userId || currentUserId;
    }

    if (currentUserId) {
      console.log('[Hypatia] Fetching campaigns for step:', currentStep);
      const campaignsResponse = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'getCampaigns', userId: currentUserId }, response => {
          // Capture runtime errors (e.g., missing receiving end) to aid debugging
          if (chrome.runtime.lastError) {
            console.error('[Hypatia] getCampaigns message error:', chrome.runtime.lastError.message);
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      });

      console.log('[Hypatia] getCampaigns response:', campaignsResponse);

      if (campaignsResponse && campaignsResponse.success && campaignsResponse.campaigns) {
        campaignsData = campaignsResponse.campaigns;
        console.log('[Hypatia] Loaded campaigns:', campaignsData.length);
      } else {
        console.error('[Hypatia] Failed to load campaigns:', campaignsResponse?.error || 'Unknown error');
      }
    } else {
      console.error('[Hypatia] Cannot fetch campaigns: no userId available');
    }
  }

  const container = document.createElement('div');
  container.id = HYPATIA_CONTAINER_ID;
  container.innerHTML = `
    <div class="hypatia-panel">
      <div class="hypatia-panel-content${(currentStep === 'campaigns' || currentStep === 'campaign_detail' || currentStep === 'leads' || currentStep === 'leads_list' || currentStep === 'template' || currentStep === 'templates_list' || currentStep === 'sent' || currentStep === 'generating') ? ' hypatia-fullwidth' : ''}">
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
    case 'generating':
      return getGeneratingStep();
    case 'leads_list':
      // Async step - return loading placeholder, then load content
      clearLeadsCache();  // Clear cache to get fresh data
      setTimeout(() => loadAsyncStepContent('leads_list'), 0);
      return getLoadingPlaceholder('leads');
    case 'templates_list':
      // Async step - return loading placeholder, then load content
      clearTemplatesCache();  // Clear cache to get fresh data
      setTimeout(() => loadAsyncStepContent('templates_list'), 0);
      return getLoadingPlaceholder('templates');
    case 'dashboard':
      return getDashboardStep();
    case 'error':
      return getErrorStep();
    default:
      return getWelcomeStep();
  }
}

// Note: getLoadingStep, getSigningInStep, getWelcomeStep are now in onboarding.js


// Note: Onboarding step functions (getWelcomeStep, getProgressStep,
// startClusteringAnimation, stopClusteringAnimation, getCompleteStep,
// CLUSTERING_MESSAGES) are now defined in onboarding.js

function getCampaignsStep() {
  // Use real data from Supabase - no dummy data fallback
  const allCampaigns = campaignsData;
  const isUsingDummyData = false;

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

function ensureAbsoluteUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return 'https://' + url;
}

// =============================================================================
// LEADS/TEMPLATES GROUPING HELPERS
// =============================================================================

function formatRelativeTime(dateString) {
  /**
   * Convert ISO date string to relative time (e.g., "2 days ago")
   */
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`;
}

function deriveTemplateName(subject) {
  /**
   * Derive a human-readable template name from subject line.
   * Returns first 3-4 words or a default name.
   */
  if (!subject) return 'Untitled Template';

  // Remove common email prefixes
  const cleaned = subject.replace(/^(re:|fwd:|fw:)\s*/gi, '').trim();
  const words = cleaned.split(/\s+/);

  if (words.length <= 4) return cleaned;
  return words.slice(0, 4).join(' ') + '...';
}

function groupDataByCampaign(items) {
  /**
   * Groups leads or templates by campaign_id.
   * Returns array of { campaign: {...}, items: [...] } objects.
   * Items without campaign_id go into an "Uncategorized" group.
   */
  const grouped = {};
  const uncategorized = [];

  items.forEach(item => {
    const campaignId = item.campaign_id;
    if (campaignId) {
      if (!grouped[campaignId]) {
        grouped[campaignId] = [];
      }
      grouped[campaignId].push(item);
    } else {
      uncategorized.push(item);
    }
  });

  // Match with campaign data from campaignsData global
  const result = [];

  Object.keys(grouped).forEach(campaignId => {
    const campaign = campaignsData.find(c => String(c.id) === String(campaignId));
    result.push({
      campaign: campaign || { id: campaignId, representative_subject: 'Unknown Campaign' },
      items: grouped[campaignId]
    });
  });

  // Add uncategorized group if any
  if (uncategorized.length > 0) {
    result.push({
      campaign: { id: null, representative_subject: 'Uncategorized' },
      items: uncategorized
    });
  }

  return result;
}

function getLoadingPlaceholder(type) {
  return `
    <div class="hypatia-step hypatia-campaigns">
      <div class="hypatia-campaigns-header">
        <div class="hypatia-campaigns-header-left">
          <h2 class="hypatia-title">${type === 'leads' ? 'Leads' : 'Templates'}</h2>
          <p class="hypatia-subtitle">Loading...</p>
        </div>
        <div class="hypatia-header-buttons">
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-${type}-close-btn">
            Close
          </button>
        </div>
      </div>
      <div class="hypatia-grouped-content">
        <div class="hypatia-loading-spinner"></div>
      </div>
    </div>
  `;
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
  const campaign = selectedCampaign;

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
            <div class="hypatia-contact-categories" id="hypatia-contact-categories"></div>
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
      <div class="hypatia-campaign-actions" style="display: flex; gap: 12px;">
        <button class="hypatia-btn hypatia-btn-secondary hypatia-btn-lg" id="hypatia-save-campaign" style="width: auto; flex: 1; margin-top: 0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Save
        </button>
        <button class="hypatia-btn hypatia-btn-primary hypatia-btn-lg" id="hypatia-continue-campaign" style="width: auto; flex: 2;">
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
  const campaign = selectedCampaign;
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
              <div class="hypatia-lead-name">
                ${escapeHtml(lead.name || lead.full_name || 'Unknown')}
                ${lead.source === 'manual' ? '<span class="hypatia-lead-badge-manual">Manual</span>' : ''}
                ${lead.linkedin_url ? `<a href="${escapeHtml(ensureAbsoluteUrl(lead.linkedin_url))}" target="_blank" class="hypatia-lead-linkedin" title="View LinkedIn profile">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>` : ''}
              </div>
              ${(lead.title || lead.company) ? `
                <div class="hypatia-lead-detail">
                  ${lead.title ? `<span class="hypatia-lead-title-inline">${escapeHtml(lead.title)}</span>` : ''}
                  ${(lead.title && lead.company) ? '<span class="hypatia-lead-separator">•</span>' : ''}
                  ${lead.company ? `<span class="hypatia-lead-company-inline">${escapeHtml(lead.company)}</span>` : ''}
                </div>
              ` : ''}
              <div class="hypatia-lead-email">${escapeHtml(lead.email || 'No email')}</div>
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

      <div class="hypatia-leads-layout">
        <div class="hypatia-leads-left">
          <div class="hypatia-leads-card">
            <label class="hypatia-input-label">Suggested updates (describe new contacts to add)</label>
            <div class="hypatia-leads-input-wrapper">
              <textarea
                class="hypatia-leads-textarea"
                id="hypatia-leads-query"
                placeholder="e.g., Add 20 product leaders at YC-backed startups in SF; include LinkedIn URLs if possible"
                rows="4"
              >${escapeHtml(campaign.contact_description || '')}</textarea>
              <div class="hypatia-leads-controls">
                <select class="hypatia-leads-limit-select" id="hypatia-leads-limit">
                  <option value="10">10 leads</option>
                  <option value="25" selected>25 leads</option>
                  <option value="50">50 leads</option>
                  <option value="100">100 leads</option>
                </select>
                <button class="hypatia-btn hypatia-btn-generate" id="hypatia-generate-leads">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                  </svg>
                  Generate Leads
                </button>
              </div>
            </div>
            <p class="hypatia-input-hint">Use natural language. Be specific about role, company type, location.</p>
            <div class="hypatia-leads-suggestions">
              <span class="hypatia-suggestions-label">Quick suggestions:</span>
              <div class="hypatia-suggestion-chips">
                <button class="hypatia-chip" data-query="50 startup founders in my network">Startup founders</button>
                <button class="hypatia-chip" data-query="Marketing managers at SaaS companies">Marketing managers</button>
                <button class="hypatia-chip" data-query="VCs and angel investors">Investors</button>
                <button class="hypatia-chip" data-query="Engineering leads at tech companies">Engineering leads</button>
              </div>
            </div>
          </div>

          <!-- Manual Lead Entry Section -->
          <div class="hypatia-leads-card hypatia-manual-entry-section">
            <div class="hypatia-section-label">Add lead manually</div>
            <div class="hypatia-manual-input-row">
              <input type="email" id="hypatia-manual-email" class="hypatia-manual-email-input" placeholder="Enter email address" />
              <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-add-manual-lead">Add</button>
            </div>
          </div>
        </div>

        <div class="hypatia-leads-right">
          <div class="hypatia-leads-section">
            <div class="hypatia-leads-header">
              <h3 class="hypatia-section-title">${hasLeads ? `Leads (${leads.length})` : 'Your Leads'}</h3>
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
              <button class="hypatia-btn hypatia-btn-primary" id="hypatia-save-leads">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                Save Leads
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// GENERATING STEP (Parallel Leads + Template)
// =============================================================================

function getGeneratingStep() {
  const campaign = selectedCampaign;
  const { leadsLoading, templateLoading, cadenceLoading, leadsResult, templateResult, cadenceResult, leadsError, templateError, cadenceError } = parallelGenerationState;

  // Determine leads display state
  let leadsContent;
  if (leadsLoading) {
    leadsContent = `
      <div class="hypatia-generating-section-loading">
        <div class="hypatia-spinner"></div>
        <p>Finding leads matching: "${escapeHtml(campaign?.contact_description || 'your criteria')}"</p>
      </div>
    `;
  } else if (leadsError) {
    leadsContent = `
      <div class="hypatia-generating-section-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c5221f" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <p>Failed to generate leads: ${escapeHtml(leadsError)}</p>
        <button class="hypatia-btn hypatia-btn-secondary hypatia-retry-leads">Retry</button>
      </div>
    `;
  } else if (leadsResult && leadsResult.leads) {
    const leads = leadsResult.leads;
    leadsContent = `
      <div class="hypatia-generating-section-success">
        <div class="hypatia-success-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#137333" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>Found ${leads.length} leads</span>
        </div>
        <div class="hypatia-mini-leads-list">
          ${leads.map(lead => `
            <div class="hypatia-mini-lead">
              <div class="hypatia-mini-lead-avatar">${lead.name ? lead.name.charAt(0).toUpperCase() : '?'}</div>
              <div class="hypatia-mini-lead-info">
                <span class="hypatia-mini-lead-name">
                  ${escapeHtml(lead.name || 'Unknown')}
                  ${lead.linkedin_url ? `<a href="${escapeHtml(ensureAbsoluteUrl(lead.linkedin_url))}" target="_blank" class="hypatia-lead-linkedin" title="View LinkedIn profile">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </a>` : ''}
                </span>
                <span class="hypatia-mini-lead-email">${escapeHtml(lead.email || 'No email')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    leadsContent = `<div class="hypatia-generating-section-pending">Waiting to start...</div>`;
  }

  // Determine template display state
  let templateContent;
  if (templateLoading) {
    templateContent = `
      <div class="hypatia-generating-section-loading">
        <div class="hypatia-spinner"></div>
        <p>Generating email template using AI...</p>
      </div>
    `;
  } else if (templateError) {
    templateContent = `
      <div class="hypatia-generating-section-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c5221f" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <p>Failed to generate template: ${escapeHtml(templateError)}</p>
        <button class="hypatia-btn hypatia-btn-secondary hypatia-retry-template">Retry</button>
      </div>
    `;
  } else if (templateResult && templateResult.template) {
    const template = templateResult.template;
    // Sync to currentTemplate if not already done
    if (!currentTemplate.subject && template.subject) {
      currentTemplate.subject = template.subject;
      currentTemplate.body = template.body || '';
    }
    templateContent = `
      <div class="hypatia-generating-section-success hypatia-template-editable">
        <div class="hypatia-success-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#137333" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>Template ready</span>
        </div>
        <div class="hypatia-inline-template-editor">
          <div class="hypatia-inline-template-field">
            <label class="hypatia-inline-label">Subject</label>
            <input type="text" class="hypatia-inline-input" id="hypatia-inline-template-subject" value="${escapeHtml(currentTemplate.subject || template.subject || '')}" placeholder="Email subject..." />
          </div>
          <div class="hypatia-inline-template-field">
            <label class="hypatia-inline-label">Body</label>
            <textarea class="hypatia-inline-textarea" id="hypatia-inline-template-body" rows="6" placeholder="Email body...">${escapeHtml(currentTemplate.body || template.body || '')}</textarea>
          </div>
          <div class="hypatia-inline-variables">
            <span class="hypatia-inline-variables-label">Variables:</span>
            <button class="hypatia-inline-var-chip" data-var="{{first_name}}">{{first_name}}</button>
            <button class="hypatia-inline-var-chip" data-var="{{last_name}}">{{last_name}}</button>
          </div>
        </div>
      </div>
    `;
  } else {
    templateContent = `<div class="hypatia-generating-section-pending">Waiting to start...</div>`;
  }

  // Determine cadence display state
  let cadenceContent;
  if (cadenceLoading) {
    cadenceContent = `
      <div class="hypatia-generating-section-loading">
        <div class="hypatia-spinner"></div>
        <p>Generating email sequence...</p>
      </div>
    `;
  } else if (cadenceError) {
    cadenceContent = `
      <div class="hypatia-generating-section-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c5221f" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <p>Failed to generate sequence: ${escapeHtml(cadenceError)}</p>
        <button class="hypatia-btn hypatia-btn-secondary hypatia-retry-cadence">Retry</button>
      </div>
    `;
  } else if (cadenceResult && cadenceResult.cadence) {
    const cadence = cadenceResult.cadence;
    cadenceContent = `
      <div class="hypatia-generating-section-success">
        <div class="hypatia-success-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#137333" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>${cadence.length}-day email sequence</span>
        </div>
        <div class="hypatia-cadence-timeline">
          ${cadence.map((email, i) => `
            <div class="hypatia-cadence-item ${email.email_type === 'initial' ? 'initial' : 'followup'}"
                 data-cadence-index="${i}" data-cadence-id="${email.id || ''}">
              <div class="hypatia-cadence-day">
                <span class="hypatia-cadence-day-badge">Day ${email.day_number}</span>
                <button class="hypatia-cadence-timing-btn" title="Change timing">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </button>
              </div>
              <div class="hypatia-cadence-content">
                <div class="hypatia-cadence-type">${email.email_type === 'initial' ? 'Initial Outreach' : `Follow-up #${i}`}</div>
                <div class="hypatia-cadence-subject">${escapeHtml(email.subject || '')}</div>
                <div class="hypatia-cadence-preview">${escapeHtml((email.body || '').substring(0, 80))}...</div>
              </div>
              <div class="hypatia-cadence-actions">
                <button class="hypatia-cadence-edit-btn" title="Edit email">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="hypatia-cadence-regenerate-btn" title="Regenerate">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
                  </svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    cadenceContent = `<div class="hypatia-generating-section-pending">Waiting to start...</div>`;
  }

  // Determine if all complete
  const allComplete = !leadsLoading && !templateLoading && !cadenceLoading &&
    (leadsResult || leadsError) && (templateResult || templateError) && (cadenceResult || cadenceError);
  const hasAnySuccess = (leadsResult && leadsResult.leads && leadsResult.leads.length > 0) ||
    (templateResult && templateResult.template) || (cadenceResult && cadenceResult.cadence);

  return `
    <div class="hypatia-step hypatia-generating-screen">
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-to-campaign">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>Back to Campaign</span>
        </button>
      </div>

      <div class="hypatia-generating-hero">
        <div class="hypatia-page-badge">Preparing Campaign</div>
        <h1 class="hypatia-page-title">${allComplete ? 'Campaign Ready' : 'Setting Up Your Campaign'}</h1>
        <p class="hypatia-page-subtitle">
          ${allComplete ? 'Review your leads, template, and email sequence below' : 'Generating leads, template, and email sequence in parallel...'}
        </p>
      </div>

      <div class="hypatia-generating-grid">
        <div class="hypatia-generating-section hypatia-generating-leads ${leadsLoading ? 'loading' : ''} ${leadsResult ? 'complete' : ''} ${leadsError ? 'error' : ''}">
          <div class="hypatia-generating-section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <h3>Contacts</h3>
          </div>
          ${leadsContent}
        </div>

        <div class="hypatia-generating-section hypatia-generating-template ${templateLoading ? 'loading' : ''} ${templateResult ? 'complete' : ''} ${templateError ? 'error' : ''}">
          <div class="hypatia-generating-section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <h3>Template</h3>
          </div>
          ${templateContent}
        </div>

        <div class="hypatia-generating-section hypatia-generating-cadence ${cadenceLoading ? 'loading' : ''} ${cadenceResult ? 'complete' : ''} ${cadenceError ? 'error' : ''}">
          <div class="hypatia-generating-section-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <h3>Email Sequence</h3>
          </div>
          ${cadenceContent}
        </div>
      </div>

      ${allComplete && hasAnySuccess ? `
        <div class="hypatia-generating-footer">
          <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-view-leads-detail">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
            </svg>
            Edit Leads
          </button>
          <button class="hypatia-btn hypatia-btn-primary" id="hypatia-proceed-to-send">
            Review & Send
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
  const campaign = selectedCampaign;
  const leads = currentLeads;
  // Use first lead for preview, or a sample lead if no leads yet
  const sampleLead = { name: 'John Doe', first_name: 'John', last_name: 'Doe', email: 'john@example.com', company: 'Acme Inc', title: 'CEO' };
  const previewLead = leads[0] || sampleLead;

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
        <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-regenerate-template">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Regenerate with AI
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
  const campaign = selectedCampaign;
  const sentEmails = campaign?.sent_emails || [];

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

// Note: getErrorStep is now in onboarding.js

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

// =============================================================================
// LEADS LIST STEP (ASYNC - FETCHES FROM SUPABASE)
// =============================================================================

// Cache for leads/templates data
let _cachedLeadsData = null;
let _cachedTemplatesData = null;

async function fetchLeadsData() {
  /**
   * Fetch leads from Supabase via background script.
   */
  if (_cachedLeadsData !== null) {
    return _cachedLeadsData;
  }

  // Ensure we have a valid userId
  let userId = currentUserId;
  if (!userId) {
    const status = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
    });
    if (status && status.userId) {
      currentUserId = status.userId;
      userId = status.userId;
    } else {
      console.warn('[Hypatia] No user ID available, cannot fetch leads');
      _cachedLeadsData = [];
      return _cachedLeadsData;
    }
  }

  const response = await new Promise(resolve => {
    chrome.runtime.sendMessage({
      action: 'getSavedLeads',
      userId: userId,
      campaignId: null  // Get all leads
    }, resolve);
  });

  if (response && response.success) {
    _cachedLeadsData = response.leads || [];
  } else {
    _cachedLeadsData = [];
  }

  return _cachedLeadsData;
}

async function fetchTemplatesData() {
  /**
   * Fetch templates from Supabase via background script.
   */
  if (_cachedTemplatesData !== null) {
    return _cachedTemplatesData;
  }

  // Ensure we have a valid userId
  let userId = currentUserId;
  if (!userId) {
    const status = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, resolve);
    });
    if (status && status.userId) {
      currentUserId = status.userId;
      userId = status.userId;
    } else {
      console.warn('[Hypatia] No user ID available, cannot fetch templates');
      _cachedTemplatesData = [];
      return _cachedTemplatesData;
    }
  }

  const response = await new Promise(resolve => {
    chrome.runtime.sendMessage({
      action: 'getAllTemplates',
      userId: userId
    }, resolve);
  });

  if (response && response.success) {
    _cachedTemplatesData = response.templates || [];
  } else {
    _cachedTemplatesData = [];
  }

  return _cachedTemplatesData;
}

function clearLeadsCache() {
  _cachedLeadsData = null;
}

function clearTemplatesCache() {
  _cachedTemplatesData = null;
}

function renderLeadCard(lead) {
  const statusClass = (lead.status || 'new').toLowerCase();
  const displayName = lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.email;
  const lastContacted = lead.contacted_at ? formatRelativeTime(lead.contacted_at) : formatRelativeTime(lead.created_at);

  return `
    <div class="hypatia-campaign-card hypatia-lead-card" data-lead-id="${lead.id}" data-lead-json="${escapeHtml(JSON.stringify(lead))}">
      <div class="hypatia-campaign-card-header">
        <span class="hypatia-lead-status hypatia-status-${statusClass}">${escapeHtml(lead.status || 'New')}</span>
      </div>
      <div class="hypatia-campaign-card-title">${escapeHtml(displayName)}</div>
      <div class="hypatia-campaign-card-recipient-cycling">
        <span class="hypatia-cycling-email">${escapeHtml(lead.email || '')}</span>
      </div>
      <div class="hypatia-campaign-analysis">
        <div class="hypatia-campaign-analysis-row">
          <span class="hypatia-analysis-icon"><strong>Company:</strong></span>
          <span class="hypatia-analysis-text">${escapeHtml(lead.company || 'N/A')}</span>
        </div>
        <div class="hypatia-campaign-analysis-row">
          <span class="hypatia-analysis-icon"><strong>Last Contact:</strong></span>
          <span class="hypatia-analysis-text">${escapeHtml(lastContacted)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderTemplateCard(template) {
  const templateName = deriveTemplateName(template.subject);
  const createdDate = formatRelativeTime(template.created_at);

  return `
    <div class="hypatia-campaign-card hypatia-template-card" data-template-id="${template.id}" data-campaign-id="${template.campaign_id}" data-template-json="${escapeHtml(JSON.stringify(template))}">
      <div class="hypatia-campaign-card-header">
        <span class="hypatia-campaign-count">1</span>
      </div>
      <div class="hypatia-campaign-card-title">${escapeHtml(templateName)}</div>
      <div class="hypatia-campaign-card-recipient-cycling">
        <span class="hypatia-cycling-email">${escapeHtml(truncate(template.subject, 50))}</span>
      </div>
      <div class="hypatia-campaign-analysis">
        <div class="hypatia-campaign-analysis-row">
          <span class="hypatia-analysis-icon"><strong>CTA:</strong></span>
          <span class="hypatia-analysis-text">${escapeHtml(template.cta_used || 'N/A')}</span>
        </div>
        <div class="hypatia-campaign-analysis-row">
          <span class="hypatia-analysis-icon"><strong>Created:</strong></span>
          <span class="hypatia-analysis-text">${escapeHtml(createdDate)}</span>
        </div>
      </div>
    </div>
  `;
}

async function getLeadsListStep() {
  const leads = await fetchLeadsData();
  const groupedLeads = groupDataByCampaign(leads);

  let contentHtml = '';

  if (groupedLeads.length === 0) {
    contentHtml = '<p class="hypatia-no-campaigns">No leads found. Generate leads from a campaign to get started.</p>';
  } else {
    contentHtml = groupedLeads.map(group => {
      const campaignTitle = group.campaign.representative_subject || 'Untitled Campaign';
      const leadCardsHtml = group.items.map(lead => renderLeadCard(lead)).join('');

      return `
        <div class="hypatia-campaign-group">
          <div class="hypatia-campaign-group-header">
            <h3 class="hypatia-campaign-group-title">${escapeHtml(truncate(campaignTitle, 60))}</h3>
            <span class="hypatia-campaign-group-count">${group.items.length} lead${group.items.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="hypatia-campaigns-grid">
            ${leadCardsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  return `
    <div class="hypatia-step hypatia-campaigns">
      <div class="hypatia-campaigns-header">
        <div class="hypatia-campaigns-header-left">
          <h2 class="hypatia-title">Leads</h2>
          <p class="hypatia-subtitle">Manage your contacts and leads by campaign</p>
        </div>
        <div class="hypatia-header-buttons">
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-add-lead-btn">
            + Add New Lead
          </button>
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-leads-close-btn">
            Close
          </button>
        </div>
      </div>

      <div class="hypatia-grouped-content">
        ${contentHtml}
      </div>
    </div>
  `;
}

// =============================================================================
// TEMPLATES LIST STEP (ASYNC - FETCHES FROM SUPABASE)
// =============================================================================

async function getTemplatesListStep() {
  const templates = await fetchTemplatesData();
  const groupedTemplates = groupDataByCampaign(templates);

  let contentHtml = '';

  if (groupedTemplates.length === 0) {
    contentHtml = '<p class="hypatia-no-campaigns">No templates found. Generate a template from a campaign to get started.</p>';
  } else {
    contentHtml = groupedTemplates.map(group => {
      const campaignTitle = group.campaign.representative_subject || 'Untitled Campaign';
      const templateCardsHtml = group.items.map(template => renderTemplateCard(template)).join('');

      return `
        <div class="hypatia-campaign-group">
          <div class="hypatia-campaign-group-header">
            <h3 class="hypatia-campaign-group-title">${escapeHtml(truncate(campaignTitle, 60))}</h3>
            <span class="hypatia-campaign-group-count">${group.items.length} template${group.items.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="hypatia-campaigns-grid">
            ${templateCardsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  return `
    <div class="hypatia-step hypatia-campaigns">
      <div class="hypatia-campaigns-header">
        <div class="hypatia-campaigns-header-left">
          <h2 class="hypatia-title">Templates</h2>
          <p class="hypatia-subtitle">Manage your email templates by campaign</p>
        </div>
        <div class="hypatia-header-buttons">
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-add-template-btn">
            + Add New Template
          </button>
          <button class="hypatia-btn hypatia-btn-add-campaign" id="hypatia-templates-close-btn">
            Close
          </button>
        </div>
      </div>

      <div class="hypatia-grouped-content">
        ${contentHtml}
      </div>
    </div>
  `;
}

async function loadAsyncStepContent(step) {
  /**
   * Load content for async steps (leads_list, templates_list)
   * and update the panel content area.
   */
  let content = '';

  if (step === 'leads_list') {
    content = await getLeadsListStep();
  } else if (step === 'templates_list') {
    content = await getTemplatesListStep();
  }

  const contentArea = document.querySelector('.hypatia-panel-content');
  if (contentArea && content) {
    contentArea.innerHTML = content;
    // Re-attach event listeners for the new content
    attachEventListeners();
  }
}

// =============================================================================
// LEAD/TEMPLATE DETAIL MODALS
// =============================================================================

function showLeadDetailModal(leadData) {
  const displayName = leadData.full_name || `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim() || 'Unknown';
  const statusClass = (leadData.status || 'new').toLowerCase();
  const createdDate = formatRelativeTime(leadData.created_at);

  const modalHtml = `
    <div class="hypatia-detail-modal-overlay" id="hypatia-detail-modal">
      <div class="hypatia-detail-modal">
        <div class="hypatia-detail-modal-header">
          <h3>Lead Details</h3>
          <button class="hypatia-modal-close" id="hypatia-close-detail-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="hypatia-detail-modal-body">
          <div class="hypatia-detail-row hypatia-detail-name-row">
            <span class="hypatia-detail-avatar">${displayName.charAt(0).toUpperCase()}</span>
            <div class="hypatia-detail-name-info">
              <span class="hypatia-detail-name">${escapeHtml(displayName)}</span>
              <span class="hypatia-lead-status hypatia-status-${statusClass}">${escapeHtml(leadData.status || 'New')}</span>
            </div>
          </div>
          <div class="hypatia-detail-grid">
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Email</span>
              <span class="hypatia-detail-value">${escapeHtml(leadData.email || 'N/A')}</span>
            </div>
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Company</span>
              <span class="hypatia-detail-value">${escapeHtml(leadData.company || 'N/A')}</span>
            </div>
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Title</span>
              <span class="hypatia-detail-value">${escapeHtml(leadData.title || 'N/A')}</span>
            </div>
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Location</span>
              <span class="hypatia-detail-value">${escapeHtml(leadData.location || 'N/A')}</span>
            </div>
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Source</span>
              <span class="hypatia-detail-value">${escapeHtml(leadData.source || 'N/A')}</span>
            </div>
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Added</span>
              <span class="hypatia-detail-value">${escapeHtml(createdDate)}</span>
            </div>
          </div>
          ${leadData.linkedin_url ? `
            <div class="hypatia-detail-actions">
              <a href="${escapeHtml(ensureAbsoluteUrl(leadData.linkedin_url))}" target="_blank" class="hypatia-btn hypatia-btn-secondary">
                View LinkedIn Profile
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Attach close handlers
  document.getElementById('hypatia-close-detail-modal')?.addEventListener('click', closeDetailModal);
  document.getElementById('hypatia-detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'hypatia-detail-modal') {
      closeDetailModal();
    }
  });
}

function showTemplateDetailModal(templateData) {
  const templateName = deriveTemplateName(templateData.subject);
  const createdDate = formatRelativeTime(templateData.created_at);

  const modalHtml = `
    <div class="hypatia-detail-modal-overlay" id="hypatia-detail-modal">
      <div class="hypatia-detail-modal hypatia-template-detail-modal">
        <div class="hypatia-detail-modal-header">
          <h3>Template Details</h3>
          <button class="hypatia-modal-close" id="hypatia-close-detail-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="hypatia-detail-modal-body">
          <div class="hypatia-detail-row">
            <span class="hypatia-detail-label">Template Name</span>
            <span class="hypatia-detail-value hypatia-detail-title">${escapeHtml(templateName)}</span>
          </div>
          <div class="hypatia-detail-row">
            <span class="hypatia-detail-label">Subject Line</span>
            <div class="hypatia-template-subject-box">${escapeHtml(templateData.subject || '')}</div>
          </div>
          <div class="hypatia-detail-row">
            <span class="hypatia-detail-label">Email Body</span>
            <div class="hypatia-template-body-box">${escapeHtml(templateData.body || '').replace(/\n/g, '<br>')}</div>
          </div>
          <div class="hypatia-detail-grid">
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">CTA Used</span>
              <span class="hypatia-detail-value">${escapeHtml(templateData.cta_used || 'N/A')}</span>
            </div>
            <div class="hypatia-detail-item">
              <span class="hypatia-detail-label">Created</span>
              <span class="hypatia-detail-value">${escapeHtml(createdDate)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Attach close handlers
  document.getElementById('hypatia-close-detail-modal')?.addEventListener('click', closeDetailModal);
  document.getElementById('hypatia-detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'hypatia-detail-modal') {
      closeDetailModal();
    }
  });
}

function closeDetailModal() {
  const modal = document.getElementById('hypatia-detail-modal');
  if (modal) {
    modal.remove();
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


// Note: Questionnaire step functions (getQuestionnaireStep, getQuestionInput,
// getAnswerValue, getBackendStatusIndicator, getWaitingStep) are now in onboarding.js

function updatePanelContent() {
  console.log('[Hypatia] updatePanelContent() called, currentStep:', currentStep);
  const content = document.querySelector('.hypatia-panel-content');
  if (content) {
    content.innerHTML = getStepContent();
    // Use full-width layout for main views
    if (currentStep === 'campaigns' || currentStep === 'campaign_detail' || currentStep === 'leads' || currentStep === 'template' || currentStep === 'sent' || currentStep === 'generating') {
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
    console.log('[Hypatia] Attaching click handler to start button');
    startBtn.addEventListener('click', () => {
      console.log('[Hypatia] Start button clicked!');
      handleStartOnboarding();
    });
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

  // Campaign card clicks (only for actual campaign cards, not lead/template cards in list views)
  const campaignCards = document.querySelectorAll('.hypatia-campaign-card:not(.hypatia-lead-card):not(.hypatia-template-card)');
  campaignCards.forEach(card => {
    card.addEventListener('click', () => {
      stopEmailCycling(); // Stop cycling when clicking a card
      const campaignId = card.dataset.campaignId;
      handleCampaignCardClick(campaignId);
    });
  });

  // Lead card clicks in leads_list view - show detail modal
  const leadCards = document.querySelectorAll('.hypatia-lead-card[data-lead-json]');
  leadCards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const leadData = JSON.parse(card.dataset.leadJson);
        showLeadDetailModal(leadData);
      } catch (err) {
        console.error('[Hypatia] Error parsing lead data:', err);
      }
    });
  });

  // Template card clicks in templates_list view - show detail modal
  const templateCards = document.querySelectorAll('.hypatia-template-card[data-template-json]');
  templateCards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const templateData = JSON.parse(card.dataset.templateJson);
        showTemplateDetailModal(templateData);
      } catch (err) {
        console.error('[Hypatia] Error parsing template data:', err);
      }
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

  // Close button in leads view
  const leadsCloseBtn = document.getElementById('hypatia-leads-close-btn');
  if (leadsCloseBtn) {
    leadsCloseBtn.addEventListener('click', navigateBack);
  }

  // Close button in templates view
  const templatesCloseBtn = document.getElementById('hypatia-templates-close-btn');
  if (templatesCloseBtn) {
    templatesCloseBtn.addEventListener('click', navigateBack);
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

  // Save Campaign button
  const saveCampaignBtn = document.getElementById('hypatia-save-campaign');
  if (saveCampaignBtn) {
    saveCampaignBtn.addEventListener('click', handleSaveCampaign);
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

    // Debounced Groq analysis on text change (500ms delay)
    contactInput.addEventListener('input', () => {
      clearTimeout(contactAnalysisDebounceTimer);
      contactAnalysisDebounceTimer = setTimeout(() => {
        analyzeContactPreference(contactInput.value);
      }, 500);
    });

    // Show all category chips immediately (all gray initially)
    updateContactPreferenceUI();

    // Run initial analysis if there's existing text
    if (contactInput.value.trim()) {
      analyzeContactPreference(contactInput.value);
    }
  }

  // Leads screen handlers
  const generateLeadsBtn = document.getElementById('hypatia-generate-leads');
  if (generateLeadsBtn) {
    generateLeadsBtn.addEventListener('click', handleGenerateLeads);
  }

  // Save leads button - goes back to campaign detail
  const saveLeadsBtn = document.getElementById('hypatia-save-leads');
  if (saveLeadsBtn) {
    saveLeadsBtn.addEventListener('click', () => {
      // Get selected leads
      const checkboxes = document.querySelectorAll('.hypatia-lead-check:checked');
      const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));
      const selectedLeads = indices.map(idx => currentLeads[idx]).filter(Boolean);

      // Save to campaign
      if (selectedCampaign) {
        selectedCampaign.leads = selectedLeads;
        currentLeads = selectedLeads;

        // Sync generating view state
        parallelGenerationState.leadsResult = { leads: selectedLeads };
        parallelGenerationState.leadsLoading = false;
        parallelGenerationState.leadsError = null;

        // Update in campaignsData array
        const campaignIndex = campaignsData.findIndex(c => c.id === selectedCampaign.id);
        if (campaignIndex !== -1) {
          campaignsData[campaignIndex].leads = selectedLeads;
        }

        console.log('[Hypatia] Saved', selectedLeads.length, 'leads for campaign:', selectedCampaign.id);
      }

      // Jump the user to Gmail Sent folder instead of showing in-app sent view
      window.location.href = 'https://mail.google.com/mail/u/0/#sent';
      return;
    });
  }

  // Manual lead entry - Add button
  const addManualLeadBtn = document.getElementById('hypatia-add-manual-lead');
  const manualEmailInput = document.getElementById('hypatia-manual-email');

  if (addManualLeadBtn) {
    addManualLeadBtn.addEventListener('click', handleAddManualLeadInContent);
  }

  if (manualEmailInput) {
    manualEmailInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddManualLeadInContent();
      }
    });
  }

  // Remove lead buttons
  const removeLeadButtons = document.querySelectorAll('.hypatia-btn-remove');
  removeLeadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (Number.isNaN(idx)) return;

      // Remove from currentLeads
      currentLeads.splice(idx, 1);

      // Sync selected campaign and campaigns list
      if (selectedCampaign) {
        selectedCampaign.leads = [...currentLeads];
        const campaignIndex = campaignsData.findIndex(c => c.id === selectedCampaign.id);
        if (campaignIndex !== -1) {
          campaignsData[campaignIndex].leads = [...currentLeads];
        }
      }

      // Keep generating view in sync
      parallelGenerationState.leadsResult = { leads: [...currentLeads] };
      parallelGenerationState.leadsLoading = false;
      parallelGenerationState.leadsError = null;

      updatePanelContent();
    });
  });

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

  const regenerateBtn = document.getElementById('hypatia-regenerate-template');
  if (regenerateBtn) {
    regenerateBtn.addEventListener('click', handleRegenerateTemplate);
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

  // Generating screen buttons
  const retryLeadsBtn = document.querySelector('.hypatia-retry-leads');
  if (retryLeadsBtn) {
    retryLeadsBtn.addEventListener('click', handleRetryLeads);
  }

  const retryTemplateBtn = document.querySelector('.hypatia-retry-template');
  if (retryTemplateBtn) {
    retryTemplateBtn.addEventListener('click', handleRetryTemplate);
  }

  // Inline template editor listeners
  const inlineSubject = document.getElementById('hypatia-inline-template-subject');
  const inlineBody = document.getElementById('hypatia-inline-template-body');

  if (inlineSubject) {
    inlineSubject.addEventListener('input', (e) => {
      currentTemplate.subject = e.target.value;
    });
  }

  if (inlineBody) {
    inlineBody.addEventListener('input', (e) => {
      currentTemplate.body = e.target.value;
    });
  }

  // Variable chip insertion for inline editor
  const inlineVarChips = document.querySelectorAll('.hypatia-inline-var-chip');
  inlineVarChips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const varText = chip.dataset.var;
      const bodyEl = document.getElementById('hypatia-inline-template-body');
      if (bodyEl) {
        const start = bodyEl.selectionStart;
        const end = bodyEl.selectionEnd;
        const text = bodyEl.value;
        bodyEl.value = text.substring(0, start) + varText + text.substring(end);
        bodyEl.selectionStart = bodyEl.selectionEnd = start + varText.length;
        bodyEl.focus();
        currentTemplate.body = bodyEl.value;
      }
    });
  });

  const retryCadenceBtn = document.querySelector('.hypatia-retry-cadence');
  if (retryCadenceBtn) {
    retryCadenceBtn.addEventListener('click', handleRetryCadence);
  }

  // Cadence item interactions
  document.querySelectorAll('.hypatia-cadence-item').forEach((item, index) => {
    // Regenerate button
    const regenerateBtn = item.querySelector('.hypatia-cadence-regenerate-btn');
    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCadenceEmailRegenerate(index);
      });
    }

    // Timing change button
    const timingBtn = item.querySelector('.hypatia-cadence-timing-btn');
    if (timingBtn) {
      timingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showTimingPicker(index, e.target);
      });
    }

    // Edit button
    const editBtn = item.querySelector('.hypatia-cadence-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCadenceEmailEdit(index);
      });
    }
  });

  const viewLeadsDetailBtn = document.getElementById('hypatia-view-leads-detail');
  if (viewLeadsDetailBtn) {
    viewLeadsDetailBtn.addEventListener('click', handleGotoLeads);
  }

  const proceedToSendBtn = document.getElementById('hypatia-proceed-to-send');
  if (proceedToSendBtn) {
    proceedToSendBtn.addEventListener('click', handleSaveAndSend);
  }

  // LinkedIn links - prevent Gmail from intercepting clicks
  document.querySelectorAll('.hypatia-lead-linkedin').forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(link.href, '_blank');
      e.preventDefault();
    });
  });
}

function handleViewCampaigns() {
  currentStep = 'campaigns';
  updatePanelContent();
}

async function handleStartOnboarding() {
  console.log('[Hypatia] handleStartOnboarding() called');

  // First check if already signed in and onboarded
  const status = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' }, (response) => {
      console.log('[Hypatia] checkOnboardingStatus response:', response);
      resolve(response);
    });
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
  // Find the campaign from real data
  let campaign = campaignsData.find(c => String(c.id) === String(campaignId)) || campaignsData[parseInt(campaignId)];

  if (!campaign) {
    console.error('[Hypatia] Campaign not found:', campaignId);
    return;
  }
  selectedCampaign = campaign;
  currentLeads = campaign.leads || [];
  currentTemplate = campaign.template || { subject: '', body: '' };
  currentStep = 'campaign_detail';

  // Track campaign viewed
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackCampaignViewed(campaignId, campaign.email_count || 0);
  }

  // Update content directly without fade effect
  updatePanelContent();

  // Update URL silently (without triggering hash change handler to re-render)
  history.replaceState(null, '', `#${HYPATIA_CAMPAIGN_HASH_PREFIX}${campaignId}`);

  // Load saved AI-generated content in background
  loadSavedCampaignContent(campaignId);
}

function handlePrevPage() {
  if (currentCampaignsPage > 1) {
    currentCampaignsPage--;
    refreshCampaignsView();
  }
}

function handleNextPage() {
  const allCampaigns = campaignsData;
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
  // Create a new blank campaign with proper UUID for Supabase
  selectedCampaign = {
    id: generateUUID(),
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
  // Sync edited campaign data back to campaignsData before leaving
  if (selectedCampaign) {
    const idx = campaignsData.findIndex(c => String(c.id) === String(selectedCampaign.id));
    if (idx !== -1) {
      campaignsData[idx] = { ...campaignsData[idx], ...selectedCampaign };
    } else if (selectedCampaign.id && !selectedCampaign.id.toString().startsWith('new_')) {
      // This is a newly created campaign that was saved - add it to the list
      campaignsData.unshift(selectedCampaign);
    }
  }

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

async function handleSaveCampaign() {
  const ctaInput = document.getElementById('hypatia-cta-input');
  const contactInput = document.getElementById('hypatia-contact-input');
  const saveBtn = document.getElementById('hypatia-save-campaign');

  if (!selectedCampaign) {
    console.error('[Hypatia] No campaign selected to save');
    return;
  }

  const fields = {};

  if (ctaInput) {
    selectedCampaign.cta_description = ctaInput.value;
    fields.cta_description = ctaInput.value;
  }
  if (contactInput) {
    selectedCampaign.contact_description = contactInput.value;
    fields.contact_description = contactInput.value;
  }

  if (Object.keys(fields).length === 0) {
    console.log('[Hypatia] No fields to save');
    return;
  }

  // Update button to show saving state
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="hypatia-spin">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/>
      </svg>
      Saving...
    `;
  }

  // Check if this is a new campaign that needs to be created first
  const isNewCampaign = selectedCampaign.id && selectedCampaign.id.toString().startsWith('new_');

  try {
    let response;

    if (isNewCampaign) {
      // Create new campaign in Supabase
      console.log('[Hypatia] Creating new campaign in Supabase');

      // Get userId
      let userId = currentUserId;
      if (!userId) {
        const status = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'getOnboardingStatus' }, resolve);
        });
        if (status && status.userId) {
          currentUserId = status.userId;
          userId = status.userId;
        }
      }

      if (!userId) {
        throw new Error('No user ID available');
      }

      response = await chrome.runtime.sendMessage({
        action: 'createCampaign',
        userId: userId,
        campaignData: {
          representative_subject: selectedCampaign.representative_subject || 'New Campaign',
          representative_recipient: selectedCampaign.representative_recipient || '',
          cta_description: fields.cta_description,
          contact_description: fields.contact_description
        }
      });

      if (response.success) {
        // Update the selectedCampaign with the real ID from Supabase
        selectedCampaign.id = response.campaignId;
        console.log('[Hypatia] New campaign created with ID:', response.campaignId);
      }
    } else {
      // Update existing campaign
      console.log('[Hypatia] Saving campaign to Supabase:', selectedCampaign.id, fields);
      response = await chrome.runtime.sendMessage({
        action: 'updateCampaign',
        campaignId: selectedCampaign.id,
        fields: fields
      });
    }

    if (response.success) {
      console.log('[Hypatia] Campaign saved successfully');
      // Show success state
      if (saveBtn) {
        saveBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Saved!
        `;
        // Reset button after 2 seconds
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            Save
          `;
        }, 2000);
      }
    } else {
      console.error('[Hypatia] Failed to save campaign:', response.error);
      // Reset button on error
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Save
        `;
      }
    }
  } catch (error) {
    console.error('[Hypatia] Error saving campaign:', error);
    // Reset button on error
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        Save
      `;
    }
  }
}

async function handleContinueCampaign() {
  // Save all edited campaign values first
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

  // Initialize parallel generation state
  parallelGenerationState = {
    isGenerating: true,
    leadsLoading: true,
    templateLoading: true,
    cadenceLoading: true,
    leadsResult: null,
    templateResult: null,
    cadenceResult: null,
    leadsError: null,
    templateError: null,
    cadenceError: null
  };

  // Navigate to generating step
  currentStep = 'generating';
  updatePanelContent();

  // Get current user info
  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (!status.userId) {
    console.error('[Hypatia] No user ID found');
    parallelGenerationState.leadsError = 'No user ID found';
    parallelGenerationState.templateError = 'No user ID found';
    parallelGenerationState.cadenceError = 'No user ID found';
    parallelGenerationState.leadsLoading = false;
    parallelGenerationState.templateLoading = false;
    parallelGenerationState.cadenceLoading = false;
    updatePanelContent();
    return;
  }

  // Create campaign in database FIRST (before parallel operations) to avoid race conditions
  try {
    const createResponse = await fetch(`${CONFIG?.API_URL || 'http://localhost:8000'}/campaigns/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: status.userId,
        campaign_id: selectedCampaign.id,
        representative_subject: selectedCampaign.representative_subject || 'New Campaign'
      })
    });
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.error('[Hypatia] Failed to create campaign:', error);
    } else {
      console.log('[Hypatia] Campaign created in database:', selectedCampaign.id);
    }
  } catch (e) {
    console.error('[Hypatia] Error creating campaign:', e);
  }

  // Trigger all three API calls in parallel
  const leadsPromise = triggerLeadsGeneration(status.userId);
  const templatePromise = triggerTemplateGeneration(status.userId);
  const cadencePromise = triggerCadenceGeneration(status.userId);

  // Wait for all (they update state independently)
  await Promise.allSettled([leadsPromise, templatePromise, cadencePromise]);
}

function handleGotoLeads() {
  currentStep = 'leads';
  updatePanelContent();
}

function handleAddManualLeadInContent() {
  const input = document.getElementById('hypatia-manual-email');
  if (!input) return;

  const email = input.value.trim();
  if (!email) return;

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    input.classList.add('hypatia-input-error');
    setTimeout(() => input.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Check for duplicate email
  const isDuplicate = currentLeads.some(lead => lead.email?.toLowerCase() === email.toLowerCase());
  if (isDuplicate) {
    input.classList.add('hypatia-input-error');
    setTimeout(() => input.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Create the manual lead object
  const manualLead = {
    email: email,
    name: '',
    title: '',
    company: '',
    source: 'manual'
  };

  // Add to the leads array
  currentLeads.push(manualLead);

  // Keep campaign state in sync
  if (selectedCampaign) {
    selectedCampaign.leads = currentLeads;
    const idx = campaignsData.findIndex(c => c.id === selectedCampaign.id);
    if (idx !== -1) {
      campaignsData[idx].leads = currentLeads;
    }
  }

  // Clear the input
  input.value = '';

  // Show the generating view (Setting Up Your Campaign) with the newly added lead reflected
  parallelGenerationState.leadsResult = { leads: currentLeads };
  parallelGenerationState.leadsLoading = false;
  parallelGenerationState.leadsError = null;
  currentStep = 'generating';
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

function handleSaveLeadsAndReturn(campaign, selectedLeads) {
  // Update the campaign's leads with only the selected ones
  if (campaign && selectedLeads) {
    campaign.leads = selectedLeads;

    // Also update in selectedCampaign if it's the same campaign
    if (selectedCampaign && selectedCampaign.id === campaign.id) {
      selectedCampaign.leads = selectedLeads;
    }

    // Update in campaignsData array
    const campaignIndex = campaignsData.findIndex(c => c.id === campaign.id);
    if (campaignIndex !== -1) {
      campaignsData[campaignIndex].leads = selectedLeads;
    }

    console.log('[Hypatia] Saved', selectedLeads.length, 'leads for campaign:', campaign.id);
  }

  // Navigate back to the setup view (leads/template/cadence) after changes
  window.location.href = 'https://mail.google.com/mail/u/0/#sent';
  return;
}

// =============================================================================
// LOAD SAVED AI-GENERATED CONTENT
// =============================================================================

async function loadSavedCampaignContent(campaignId) {
  /**
   * Load previously saved AI-generated content (leads, template, CTAs) for a campaign.
   * Updates the UI if saved content is found.
   */
  try {
    // Get current user info
    const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
    if (!status.userId) {
      console.log('[Hypatia] No user ID, skipping saved content load');
      return;
    }

    console.log('[Hypatia] Loading saved content for campaign:', campaignId);

    const response = await chrome.runtime.sendMessage({
      action: 'getSavedContent',
      userId: status.userId,
      campaignId: campaignId
    });

    if (!response.success) {
      console.log('[Hypatia] No saved content found or error:', response.error);
      return;
    }

    if (!response.hasSavedContent) {
      console.log('[Hypatia] No saved content for this campaign');
      return;
    }

    console.log('[Hypatia] Found saved content:', {
      leads: response.leads?.length || 0,
      hasTemplate: !!response.template,
      ctas: response.ctas?.length || 0
    });

    // Update local state with saved content
    let needsUpdate = false;

    // Load saved leads
    if (response.leads && response.leads.length > 0) {
      currentLeads = response.leads.map(lead => ({
        name: lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        title: lead.title,
        company: lead.company,
        location: lead.location,
        linkedin_url: lead.linkedin_url,
        status: lead.status || 'new',
      }));
      if (selectedCampaign) {
        selectedCampaign.leads = currentLeads;
      }
      needsUpdate = true;
      console.log('[Hypatia] Loaded', currentLeads.length, 'saved leads');
    }

    // Load saved template
    if (response.template) {
      currentTemplate = {
        subject: response.template.subject || '',
        body: response.template.body || '',
        placeholders: response.template.placeholders || [],
      };
      if (selectedCampaign) {
        selectedCampaign.template = currentTemplate;
      }
      needsUpdate = true;
      console.log('[Hypatia] Loaded saved template');
    }

    // Load saved CTAs (update the campaign's CTA description with the first one)
    if (response.ctas && response.ctas.length > 0 && selectedCampaign) {
      // Store all CTAs for later use
      selectedCampaign.saved_ctas = response.ctas;
      // If no CTA description is set, use the first saved one
      if (!selectedCampaign.cta_description && response.ctas[0]) {
        selectedCampaign.cta_description = response.ctas[0].description;
      }
      needsUpdate = true;
      console.log('[Hypatia] Loaded', response.ctas.length, 'saved CTAs');
    }

    // Refresh UI if we loaded any content and still viewing this campaign
    if (needsUpdate && currentStep === 'campaign_detail' && selectedCampaign?.id === campaignId) {
      updatePanelContent();
    }

  } catch (error) {
    console.error('[Hypatia] Error loading saved content:', error);
  }
}


// =============================================================================
// PARALLEL GENERATION HELPERS
// =============================================================================

async function triggerLeadsGeneration(userId) {
  try {
    const query = selectedCampaign?.contact_description || '';
    if (!query.trim()) {
      parallelGenerationState.leadsError = 'No contact description provided. Please go back and fill in "Who to contact".';
      parallelGenerationState.leadsLoading = false;
      updatePanelContent();
      return;
    }

    console.log('[Hypatia] Starting parallel leads generation with query:', query);

    const response = await chrome.runtime.sendMessage({
      action: 'generateLeads',
      userId: userId,
      campaignId: selectedCampaign?.id,
      query: query,
      limit: 25
    });

    if (response.success && response.leads) {
      currentLeads = response.leads;
      if (selectedCampaign) {
        selectedCampaign.leads = currentLeads;
      }
      parallelGenerationState.leadsResult = response;
      console.log(`[Hypatia] Parallel leads generation complete: ${currentLeads.length} leads`);
    } else {
      parallelGenerationState.leadsError = response.error || 'Unknown error generating leads';
      console.error('[Hypatia] Parallel leads generation failed:', response.error);
    }
  } catch (error) {
    parallelGenerationState.leadsError = error.message;
    console.error('[Hypatia] Parallel leads generation error:', error);
  } finally {
    parallelGenerationState.leadsLoading = false;
    updatePanelContent();
  }
}

async function triggerTemplateGeneration(userId) {
  try {
    console.log('[Hypatia] Starting parallel template generation');

    const response = await chrome.runtime.sendMessage({
      action: 'generateTemplate',
      userId: userId,
      campaignId: selectedCampaign?.id,
      cta: selectedCampaign?.cta_description || '',
      stylePrompt: selectedCampaign?.style_prompt || selectedCampaign?.style_description || '',
      sampleEmails: selectedCampaign?.emails || [],
      currentSubject: null,
      currentBody: null
    });

    if (response.success && response.template) {
      currentTemplate.subject = response.template.subject || '';
      currentTemplate.body = response.template.body || '';

      // Store original template for edit tracking
      originalTemplate.subject = currentTemplate.subject;
      originalTemplate.body = currentTemplate.body;

      parallelGenerationState.templateResult = response;
      // Store template_id for edit tracking
      if (response.template_id && selectedCampaign) {
        selectedCampaign.template_id = response.template_id;
        console.log('[Hypatia] Stored template_id for edit tracking:', response.template_id);
      }
      console.log('[Hypatia] Parallel template generation complete');
    } else {
      parallelGenerationState.templateError = response.error || 'Unknown error generating template';
      console.error('[Hypatia] Parallel template generation failed:', response.error);
    }
  } catch (error) {
    parallelGenerationState.templateError = error.message;
    console.error('[Hypatia] Parallel template generation error:', error);
  } finally {
    parallelGenerationState.templateLoading = false;
    updatePanelContent();
  }
}

async function handleRetryLeads() {
  parallelGenerationState.leadsLoading = true;
  parallelGenerationState.leadsError = null;
  parallelGenerationState.leadsResult = null;
  updatePanelContent();

  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (status.userId) {
    await triggerLeadsGeneration(status.userId);
  }
}

async function handleRetryTemplate() {
  parallelGenerationState.templateLoading = true;
  parallelGenerationState.templateError = null;
  parallelGenerationState.templateResult = null;
  updatePanelContent();

  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (status.userId) {
    await triggerTemplateGeneration(status.userId);
  }
}

async function triggerCadenceGeneration(userId) {
  try {
    console.log('[Hypatia] Starting parallel cadence generation');

    const response = await chrome.runtime.sendMessage({
      action: 'generateCadence',
      userId: userId,
      campaignId: selectedCampaign?.id,
      stylePrompt: selectedCampaign?.style_description || selectedCampaign?.style_prompt || '',
      sampleEmails: selectedCampaign?.emails || [],
      timing: currentCadenceTiming
    });

    if (response.success && response.cadence) {
      parallelGenerationState.cadenceResult = response;
      console.log(`[Hypatia] Parallel cadence generation complete: ${response.cadence.length} emails`);
    } else {
      parallelGenerationState.cadenceError = response.error || 'Unknown error generating cadence';
      console.error('[Hypatia] Parallel cadence generation failed:', response.error);
    }
  } catch (error) {
    parallelGenerationState.cadenceError = error.message;
    console.error('[Hypatia] Parallel cadence generation error:', error);
  } finally {
    parallelGenerationState.cadenceLoading = false;
    updatePanelContent();
  }
}

async function handleRetryCadence() {
  parallelGenerationState.cadenceLoading = true;
  parallelGenerationState.cadenceError = null;
  parallelGenerationState.cadenceResult = null;
  updatePanelContent();

  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (status.userId) {
    await triggerCadenceGeneration(status.userId);
  }
}

async function handleCadenceTimingChange(index, newDay) {
  // Update timing and re-render
  const keys = ['day_1', 'day_2', 'day_3', 'day_4'];
  currentCadenceTiming[keys[index]] = newDay;

  // Update in local result for immediate UI feedback
  if (parallelGenerationState.cadenceResult?.cadence) {
    parallelGenerationState.cadenceResult.cadence[index].day_number = newDay;
    updatePanelContent();
  }

  // Save to backend
  const cadenceId = parallelGenerationState.cadenceResult?.cadence[index]?.id;
  if (cadenceId) {
    await chrome.runtime.sendMessage({
      action: 'updateCadenceEmail',
      cadenceId: cadenceId,
      updates: { day_number: newDay }
    });
  }
}

async function handleCadenceEmailRegenerate(index) {
  const cadenceId = parallelGenerationState.cadenceResult?.cadence[index]?.id;
  if (!cadenceId) return;

  // Show loading state for this specific email
  const item = document.querySelector(`[data-cadence-index="${index}"]`);
  if (item) item.classList.add('regenerating');

  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  const response = await chrome.runtime.sendMessage({
    action: 'regenerateCadenceEmail',
    cadenceId: cadenceId,
    userId: status.userId
  });

  if (response.success && response.email) {
    // Update local state
    parallelGenerationState.cadenceResult.cadence[index] = response.email;
    updatePanelContent();
  }
}

function handleCadenceEmailEdit(index) {
  const email = parallelGenerationState.cadenceResult?.cadence[index];
  if (!email) return;

  const item = document.querySelector(`[data-cadence-index="${index}"]`);
  if (!item) return;

  // Check if already in edit mode
  if (item.classList.contains('editing')) return;

  item.classList.add('editing');

  const contentDiv = item.querySelector('.hypatia-cadence-content');
  if (!contentDiv) return;

  // Store original content for cancel
  const originalSubject = email.subject || '';
  const originalBody = email.body || '';

  // Replace content with editable fields
  contentDiv.innerHTML = `
    <div class="hypatia-cadence-type">${email.email_type === 'initial' ? 'Initial Outreach' : `Follow-up #${index}`}</div>
    <input type="text" class="hypatia-cadence-subject-input" value="${escapeHtml(originalSubject)}" placeholder="Email subject...">
    <textarea class="hypatia-cadence-body-input" placeholder="Email body...">${escapeHtml(originalBody)}</textarea>
    <div class="hypatia-cadence-edit-actions">
      <button class="hypatia-cadence-save-btn">Save</button>
      <button class="hypatia-cadence-cancel-btn">Cancel</button>
    </div>
  `;

  // Focus the subject input
  const subjectInput = contentDiv.querySelector('.hypatia-cadence-subject-input');
  if (subjectInput) subjectInput.focus();

  // Handle save
  const saveBtn = contentDiv.querySelector('.hypatia-cadence-save-btn');
  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newSubject = contentDiv.querySelector('.hypatia-cadence-subject-input').value;
    const newBody = contentDiv.querySelector('.hypatia-cadence-body-input').value;

    // Update local state
    parallelGenerationState.cadenceResult.cadence[index].subject = newSubject;
    parallelGenerationState.cadenceResult.cadence[index].body = newBody;

    // Save to backend if we have an ID
    const cadenceId = email.id;
    if (cadenceId) {
      try {
        const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
        await chrome.runtime.sendMessage({
          action: 'updateCadenceEmail',
          cadenceId: cadenceId,
          userId: status.userId,
          subject: newSubject,
          body: newBody
        });
      } catch (err) {
        console.error('[Hypatia] Failed to save cadence email:', err);
      }
    }

    item.classList.remove('editing');
    updatePanelContent();
  });

  // Handle cancel
  const cancelBtn = contentDiv.querySelector('.hypatia-cadence-cancel-btn');
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    item.classList.remove('editing');
    updatePanelContent();
  });
}

function showTimingPicker(index, targetElement) {
  // Remove any existing picker
  const existingPicker = document.querySelector('.hypatia-timing-picker');
  if (existingPicker) {
    existingPicker.remove();
  }

  const currentDay = parallelGenerationState.cadenceResult?.cadence[index]?.day_number || 1;

  // Day options based on email type
  const dayOptions = index === 0
    ? [1, 2, 3]  // Initial outreach: Day 1-3
    : [2, 3, 5, 7, 10, 14, 21, 30];  // Follow-ups: various intervals

  const picker = document.createElement('div');
  picker.className = 'hypatia-timing-picker';
  picker.innerHTML = dayOptions.map(day => `
    <button class="hypatia-timing-option ${day === currentDay ? 'selected' : ''}" data-day="${day}">
      Day ${day}
    </button>
  `).join('');

  // Position the picker near the button
  const rect = targetElement.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = `${rect.bottom + 5}px`;
  picker.style.left = `${rect.left}px`;

  document.body.appendChild(picker);

  // Handle option clicks
  picker.querySelectorAll('.hypatia-timing-option').forEach(option => {
    option.addEventListener('click', () => {
      const newDay = parseInt(option.dataset.day, 10);
      handleCadenceTimingChange(index, newDay);
      picker.remove();
    });
  });

  // Close picker when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closePicker(e) {
      if (!picker.contains(e.target) && e.target !== targetElement) {
        picker.remove();
        document.removeEventListener('click', closePicker);
      }
    });
  }, 0);
}

async function handleGenerateLeads() {
  const query = document.getElementById('hypatia-leads-query')?.value?.trim();
  if (!query) {
    return;
  }

  const limitSelect = document.getElementById('hypatia-leads-limit');
  const limit = parseInt(limitSelect?.value || '25', 10);

  // Get current user info
  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (!status.userId) {
    console.error('[Hypatia] No user ID found');
    return;
  }

  // Track lead generation started
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackLeadGenerationStarted(selectedCampaign?.id, query);
  }

  // Show loading state
  const generateBtn = document.getElementById('hypatia-generate-leads');
  const originalBtnContent = generateBtn?.innerHTML;
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.innerHTML = `
      <div class="hypatia-spinner-small"></div>
      Finding leads...
    `;
  }

  try {
    // Call the backend API via background.js
    const response = await chrome.runtime.sendMessage({
      action: 'generateLeads',
      userId: status.userId,
      campaignId: selectedCampaign?.id,
      query: query,
      limit: limit
    });

    if (response.success && response.leads) {
      currentLeads = response.leads;

      // Update the campaign's leads
      if (selectedCampaign) {
        selectedCampaign.leads = currentLeads;
      }

      // Track lead generation completed
      if (window.HypatiaAnalytics) {
        window.HypatiaAnalytics.trackLeadGenerationCompleted(selectedCampaign?.id, currentLeads.length, true);
      }

      console.log(`[Hypatia] Generated ${currentLeads.length} leads`);
    } else {
      console.error('[Hypatia] Lead generation failed:', response.error);
      // Track failure
      if (window.HypatiaAnalytics) {
        window.HypatiaAnalytics.trackLeadGenerationCompleted(selectedCampaign?.id, 0, false);
      }
      // Show error to user
      alert(`Lead generation failed: ${response.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('[Hypatia] Lead generation error:', error);
    // Track failure
    if (window.HypatiaAnalytics) {
      window.HypatiaAnalytics.trackLeadGenerationCompleted(selectedCampaign?.id, 0, false);
    }
    alert(`Lead generation failed: ${error.message}`);
  } finally {
    // Restore button state
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = originalBtnContent;
    }

    // Re-render to show the leads (or error state)
    updatePanelContent();
  }
}

function handleSaveAndSend() {
  // Save the template - check both main template inputs and inline template inputs
  const subjectInput = document.getElementById('hypatia-template-subject')
    || document.getElementById('hypatia-inline-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body')
    || document.getElementById('hypatia-inline-template-body');

  const newSubject = subjectInput?.value || '';
  const newBody = bodyInput?.value || '';

  // FEEDBACK LOOP: Record template edits to learn user preferences
  // Only record if we have both the original and new values
  if (selectedCampaign?.template_id && currentUserId) {
    recordTemplateEdit(selectedCampaign.template_id, newSubject, newBody);
  }

  currentTemplate.subject = newSubject;
  currentTemplate.body = newBody;

  if (selectedCampaign) {
    selectedCampaign.template = { ...currentTemplate };
  }

  // Validate we have leads and template
  if (!currentLeads || currentLeads.length === 0) {
    alert('No leads selected. Please generate or add leads first.');
    return;
  }

  if (!currentTemplate.subject || !currentTemplate.body) {
    alert('Please fill in both subject and body.');
    return;
  }

  // Show review modal instead of directly sending
  showReviewModal();
}

/**
 * Record template edits to the backend for preference learning.
 * This helps the AI learn how you like your emails styled.
 */
async function recordTemplateEdit(templateId, newSubject, newBody) {
  try {
    const response = await fetch(`${CONFIG?.API_URL || 'http://localhost:8000'}/feedback/record-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        user_id: currentUserId,
        new_subject: newSubject,
        new_body: newBody,
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('[Hypatia] Preferences updated:', result.edit_analysis);

      // Track in analytics
      if (window.HypatiaAnalytics) {
        window.HypatiaAnalytics.track('template_preferences_learned', {
          template_id: templateId,
          subject_shortened: result.edit_analysis?.subject_changes?.shortened,
          subject_lengthened: result.edit_analysis?.subject_changes?.lengthened,
          body_shortened: result.edit_analysis?.body_changes?.shortened,
          body_more_casual: result.edit_analysis?.body_changes?.more_casual,
          body_more_formal: result.edit_analysis?.body_changes?.more_formal,
        });
      }
    }
  } catch (error) {
    console.log('[Hypatia] Could not record template edit:', error.message);
  }
}

// =============================================================================
// EMAIL REVIEW & SEND MODAL
// =============================================================================

function showReviewModal() {
  // Prepare emails with personalized content
  const emails = currentLeads.map(lead => ({
    lead: lead,
    subject: replaceTemplateVariables(currentTemplate.subject, lead),
    body: replaceTemplateVariables(currentTemplate.body, lead)
  }));

  // Get the first lead for preview
  const previewEmail = emails[0];
  const lead = previewEmail.lead;
  const initials = (lead.name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  // Create modal HTML
  const modalHtml = `
    <div class="hypatia-review-modal-overlay" id="hypatia-review-modal">
      <div class="hypatia-review-modal">
        <div class="hypatia-review-modal-header">
          <h3>Review Email Before Sending</h3>
          <button class="hypatia-modal-close" id="hypatia-close-review-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="hypatia-review-modal-body">
          <!-- Recipient info card -->
          <div class="hypatia-recipient-card">
            <div class="hypatia-recipient-avatar">
              <span>${initials}</span>
            </div>
            <div class="hypatia-recipient-info">
              <div class="hypatia-recipient-name">${lead.name || 'Unknown'}</div>
              <div class="hypatia-recipient-email">${lead.email || ''}</div>
              <div class="hypatia-recipient-company">${lead.title || ''} ${lead.company ? '@ ' + lead.company : ''}</div>
            </div>
          </div>

          <!-- Email preview -->
          <div class="hypatia-email-preview-box">
            <div class="hypatia-preview-subject-row">
              <label>Subject:</label>
              <div>${escapeHtml(previewEmail.subject)}</div>
            </div>
            <div class="hypatia-preview-body-row">
              <label>Message:</label>
              <div>${escapeHtml(previewEmail.body).replace(/\n/g, '<br>')}</div>
            </div>
          </div>

          <!-- Info about other emails -->
          <div class="hypatia-review-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>${emails.length - 1} more similar emails will be sent with personalized names and details</span>
          </div>
        </div>

        <div class="hypatia-review-modal-footer">
          <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-review-cancel">
            Cancel
          </button>
          <button class="hypatia-btn hypatia-btn-primary" id="hypatia-send-all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22,2 15,22 11,13 2,9"></polygon>
            </svg>
            Send All ${emails.length} Emails
          </button>
        </div>
      </div>
    </div>
  `;

  // Insert modal into DOM
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Set up event listeners
  document.getElementById('hypatia-close-review-modal')?.addEventListener('click', closeReviewModal);
  document.getElementById('hypatia-review-cancel')?.addEventListener('click', closeReviewModal);
  document.getElementById('hypatia-send-all')?.addEventListener('click', () => sendAllEmailsWithProgress(emails));

  // Close on overlay click
  document.getElementById('hypatia-review-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'hypatia-review-modal') {
      closeReviewModal();
    }
  });
}

function closeReviewModal() {
  const modal = document.getElementById('hypatia-review-modal');
  if (modal) {
    modal.remove();
  }
}

function showSendingProgressModal(totalEmails) {
  // Remove review modal if present
  closeReviewModal();

  const modalHtml = `
    <div class="hypatia-review-modal-overlay" id="hypatia-sending-modal">
      <div class="hypatia-sending-modal">
        <div class="hypatia-sending-icon">
          <div class="hypatia-spinner"></div>
        </div>
        <h3>Sending Emails...</h3>
        <div class="hypatia-sending-progress">
          <div class="hypatia-progress-bar">
            <div class="hypatia-progress-fill" id="hypatia-send-progress-bar" style="width: 0%"></div>
          </div>
          <div class="hypatia-progress-text">
            <span id="hypatia-sent-count">0</span> of ${totalEmails} sent
          </div>
        </div>
        <div class="hypatia-sending-status" id="hypatia-sending-status">
          Preparing to send...
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function updateSendingProgress(current, total, currentEmail) {
  const progressBar = document.getElementById('hypatia-send-progress-bar');
  const sentCount = document.getElementById('hypatia-sent-count');
  const status = document.getElementById('hypatia-sending-status');

  if (progressBar) {
    progressBar.style.width = `${(current / total) * 100}%`;
  }
  if (sentCount) {
    sentCount.textContent = current;
  }
  if (status && currentEmail) {
    status.textContent = `Sending to: ${currentEmail}`;
  }
}

function closeSendingModal() {
  const modal = document.getElementById('hypatia-sending-modal');
  if (modal) {
    modal.remove();
  }
}

function showSendingResultsModal(results) {
  closeSendingModal();

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const allSuccess = failedCount === 0;

  const failedList = results.filter(r => !r.success);

  const modalHtml = `
    <div class="hypatia-review-modal-overlay" id="hypatia-results-modal">
      <div class="hypatia-results-modal">
        <div class="hypatia-results-icon ${allSuccess ? 'success' : 'partial'}">
          ${allSuccess
            ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#137333" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22,4 12,14.01 9,11.01"></polyline></svg>'
            : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ea8600" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
          }
        </div>
        <h3>${allSuccess ? 'All Emails Sent!' : 'Sending Complete'}</h3>

        <div class="hypatia-results-stats">
          <div class="hypatia-result-stat success">
            <span class="hypatia-stat-number">${successCount}</span>
            <span class="hypatia-stat-label">Sent Successfully</span>
          </div>
          ${failedCount > 0 ? `
            <div class="hypatia-result-stat failed">
              <span class="hypatia-stat-number">${failedCount}</span>
              <span class="hypatia-stat-label">Failed</span>
            </div>
          ` : ''}
        </div>

        ${failedCount > 0 ? `
          <div class="hypatia-failed-list">
            <h4>Failed Emails:</h4>
            <ul>
              ${failedList.map(r => `<li>${escapeHtml(r.recipient_email)}: ${escapeHtml(r.error || 'Unknown error')}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-results-done">
          View Sent Emails
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('hypatia-results-done')?.addEventListener('click', () => {
    closeResultsModal();
    // Navigate to sent screen
    currentStep = 'sent';
    updatePanelContent();
  });
}

function closeResultsModal() {
  const modal = document.getElementById('hypatia-results-modal');
  if (modal) {
    modal.remove();
  }
}

async function sendAllEmailsWithProgress(emails) {
  showSendingProgressModal(emails.length);

  // Get user info
  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (!status.userId) {
    closeSendingModal();
    alert('Error: Not logged in. Please refresh and try again.');
    return;
  }

  // Track email batch started
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackEmailBatchStarted(selectedCampaign?.id, emails.length);
  }

  const results = [];

  // Send emails one by one for real-time progress
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    updateSendingProgress(i, emails.length, email.lead.email);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'sendSingleEmail',
        userId: status.userId,
        campaignId: selectedCampaign?.id,
        email: {
          recipient_email: email.lead.email,
          recipient_name: email.lead.name,
          subject: email.subject,
          body: email.body
        }
      });

      results.push({
        recipient_email: email.lead.email,
        recipient_name: email.lead.name,
        success: response.success,
        gmail_id: response.gmail_id,
        thread_id: response.thread_id,
        error: response.error
      });

      // Check for auth error - stop immediately
      if (response.authError) {
        closeSendingModal();
        alert('Gmail authentication expired. Please sign out and sign back in.');
        return;
      }
    } catch (error) {
      results.push({
        recipient_email: email.lead.email,
        recipient_name: email.lead.name,
        success: false,
        error: error.message
      });
    }

    // Update progress after each send
    updateSendingProgress(i + 1, emails.length, null);
  }

  // Update local state with sent emails
  if (selectedCampaign) {
    selectedCampaign.sent_emails = results.map(r => ({
      recipient_name: r.recipient_name,
      recipient_email: r.recipient_email,
      subject: emails.find(e => e.lead.email === r.recipient_email)?.subject || '',
      body: emails.find(e => e.lead.email === r.recipient_email)?.body || '',
      status: r.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      gmail_id: r.gmail_id,
      thread_id: r.thread_id,
      error: r.error
    }));
  }

  // Track email batch completed
  const sentCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackEmailBatchCompleted(selectedCampaign?.id, sentCount, failedCount);
  }

  // Show results
  showSendingResultsModal(results);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function handleRegenerateTemplate() {
  // Get current template values
  const subjectInput = document.getElementById('hypatia-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body');
  const currentSubject = subjectInput?.value || '';
  const currentBody = bodyInput?.value || '';

  // Get current user info
  const status = await chrome.runtime.sendMessage({ action: 'checkOnboardingStatus' });
  if (!status.userId) {
    console.error('[Hypatia] No user ID found');
    return;
  }

  // Track template generation started
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackTemplateGenerationStarted(selectedCampaign?.id);
  }

  // Show loading state
  const regenerateBtn = document.getElementById('hypatia-regenerate-template');
  const originalBtnContent = regenerateBtn?.innerHTML;
  if (regenerateBtn) {
    regenerateBtn.disabled = true;
    regenerateBtn.innerHTML = `
      <div class="hypatia-spinner-small"></div>
      Generating...
    `;
  }

  try {
    // Call the backend API via background.js
    const response = await chrome.runtime.sendMessage({
      action: 'generateTemplate',
      userId: status.userId,
      campaignId: selectedCampaign?.id,
      cta: selectedCampaign?.cta_description || '',
      stylePrompt: selectedCampaign?.style_prompt || selectedCampaign?.style_description || '',
      sampleEmails: selectedCampaign?.emails || [],
      currentSubject: currentSubject,
      currentBody: currentBody
    });

    if (response.success && response.template) {
      // Update the template inputs
      if (subjectInput) {
        subjectInput.value = response.template.subject || '';
      }
      if (bodyInput) {
        bodyInput.value = response.template.body || '';
      }

      // Update currentTemplate state
      currentTemplate.subject = response.template.subject || '';
      currentTemplate.body = response.template.body || '';

      // Store original template for edit tracking
      originalTemplate.subject = currentTemplate.subject;
      originalTemplate.body = currentTemplate.body;

      // Track template generated
      if (window.HypatiaAnalytics) {
        window.HypatiaAnalytics.trackTemplateGenerated(
          selectedCampaign?.id,
          !!currentTemplate.subject,
          currentTemplate.body?.length || 0
        );
      }

      // Update the preview
      updateTemplatePreview();

      console.log('[Hypatia] Template regenerated successfully');
    } else {
      console.error('[Hypatia] Template generation failed:', response.error);
      alert(`Template generation failed: ${response.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('[Hypatia] Template generation error:', error);
    alert(`Template generation failed: ${error.message}`);
  } finally {
    // Restore button state
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = originalBtnContent;
    }
  }
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

  // Use first lead for preview, or a sample lead if no leads yet
  const sampleLead = { name: 'John Doe', first_name: 'John', last_name: 'Doe', email: 'john@example.com', company: 'Acme Inc', title: 'CEO' };
  const previewLead = currentLeads[0] || sampleLead;

  if (previewSubject) {
    previewSubject.textContent = replaceTemplateVariables(currentTemplate.subject, previewLead);
  }

  if (previewBody) {
    previewBody.innerHTML = escapeHtml(replaceTemplateVariables(currentTemplate.body, previewLead)).replace(/\n/g, '<br>');
  }
}


// Note: Questionnaire handlers (handleQuestionnaireNext, handleQuestionnairePrev,
// handleQuestionnaireSkip, collectCurrentAnswer, showValidationError,
// handleQuestionnaireComplete, checkBothProcessesComplete) are now in onboarding.js

// =============================================================================
// MESSAGE LISTENER (from background script)
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'onboardingProgress') {
    // Delegate to onboarding.js handler
    handleOnboardingProgressUpdate(message);
  }
});

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
      <div class="hypatia-sidebar-item" data-tab="leads">
        <span class="hypatia-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </span>
        <span class="hypatia-item-label">Leads</span>
      </div>
      <div class="hypatia-sidebar-item" data-tab="templates">
        <span class="hypatia-item-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </span>
        <span class="hypatia-item-label">Templates</span>
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
    'leads': '#hypatia/leads',
    'templates': '#hypatia/templates',
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
      (tab === 'leads' && hash === 'hypatia/leads') ||
      (tab === 'templates' && hash === 'hypatia/templates') ||
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
