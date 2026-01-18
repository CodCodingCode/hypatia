// Hypatia Leads Screen
// Generate and manage leads for a campaign using natural language

// =============================================================================
// LEADS STATE
// =============================================================================

let leadsForCampaign = [];
let leadsCampaign = null;
let emailPlaceholderInterval = null;

// Example emails to cycle through in the manual entry placeholder
const EXAMPLE_EMAILS = [
  '20anmercer@health.ucsd.edu',
  'sarah.chen@stanford.edu',
  'jsmith@techstartup.io',
  'maria.garcia@company.com',
  'alex.kim@venture.capital'
];

// =============================================================================
// LEADS SCREEN
// =============================================================================

function getLeadsScreen(campaign) {
  leadsCampaign = campaign;
  leadsForCampaign = campaign.leads || [];

  const hasLeads = leadsForCampaign.length > 0;

  return `
    <div class="hypatia-step hypatia-leads-screen">
      <!-- Header -->
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-to-campaign">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>Back to Campaign</span>
        </button>
      </div>

      <!-- Two Column Layout -->
      <div class="hypatia-leads-layout">
        <!-- Left Column: Leads List -->
        <div class="hypatia-leads-left">
          <!-- Manual Lead Entry Section -->
          <div class="hypatia-manual-entry-section">
            <div class="hypatia-section-label">Add Lead Manually</div>
            <div class="hypatia-manual-input-row">
              <input type="text" id="hypatia-manual-first-name" class="hypatia-manual-name-input" placeholder="First name" required />
              <input type="text" id="hypatia-manual-last-name" class="hypatia-manual-name-input" placeholder="Last name" required />
            </div>
            <div class="hypatia-manual-input-row">
              <input type="email" id="hypatia-manual-email" class="hypatia-manual-email-input" placeholder="Enter email address" required />
              <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-add-manual-lead">Add</button>
            </div>
          </div>

          <div class="hypatia-leads-section">
            <div class="hypatia-leads-header">
              <h3 class="hypatia-section-title">
                ${hasLeads ? `Leads (${leadsForCampaign.length})` : 'Your Leads'}
              </h3>
              ${hasLeads ? `
                <div class="hypatia-leads-actions">
                  <button class="hypatia-btn-icon" id="hypatia-export-leads" title="Export CSV">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                </div>
              ` : ''}
            </div>

            ${hasLeads ? getLeadsListHtml(leadsForCampaign) : getEmptyLeadsHtml()}

            <!-- Footer inside leads section -->
            ${hasLeads ? `
              <div class="hypatia-leads-footer">
                <div class="hypatia-leads-selected-count">
                  <span id="hypatia-selected-count">0</span> of ${leadsForCampaign.length} selected
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

        <!-- Right Column: Search Controls -->
        <div class="hypatia-leads-right">
          <!-- Title -->
          <div class="hypatia-leads-hero">
            <div class="hypatia-page-badge">Leads</div>
            <h1 class="hypatia-page-title">Generate Leads</h1>
            <p class="hypatia-page-subtitle">
              Find people to contact for: <strong>${escapeHtml(campaign.representative_subject || 'this campaign')}</strong>
            </p>
          </div>

          <!-- Natural Language Input -->
          <div class="hypatia-leads-input-section">
            <label class="hypatia-input-label">Describe who you want to contact</label>
            <div class="hypatia-leads-input-wrapper">
              <textarea
                class="hypatia-leads-textarea"
                id="hypatia-leads-query"
                placeholder="e.g., CTOs at YC-backed startups in San Francisco, Marketing directors at e-commerce companies..."
                rows="3"
              ></textarea>
              <div class="hypatia-leads-controls">
                <select class="hypatia-leads-limit-select" id="hypatia-leads-limit">
                  <option value="5">5 leads</option>
                  <option value="10" selected>10 leads</option>
                  <option value="15">15 leads</option>
                  <option value="20">20 leads</option>
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
            <p class="hypatia-input-hint">
              Be specific about role, company type, location, or any other criteria
            </p>
          </div>

          <!-- Quick Suggestions -->
          <div class="hypatia-leads-suggestions">
            <span class="hypatia-suggestions-label">Quick suggestions:</span>
            <div class="hypatia-suggestion-chips">
              <button class="hypatia-chip" data-query="Startup founders">Startup founders</button>
              <button class="hypatia-chip" data-query="Marketing managers at SaaS companies">Marketing managers</button>
              <button class="hypatia-chip" data-query="Investors">Investors</button>
              <button class="hypatia-chip" data-query="Engineering leads at tech companies">Engineering leads</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;
}

function getLeadsListHtml(leads) {
  return `
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
              ${escapeHtml(lead.name || 'Unknown')}
              ${lead.source === 'manual' ? '<span class="hypatia-lead-badge-manual">Manual</span>' : ''}
              ${lead.linkedinUrl ? `
                <a href="${escapeHtml(lead.linkedinUrl)}" target="_blank" class="hypatia-lead-linkedin" title="View LinkedIn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
                  </svg>
                </a>
              ` : ''}
            </div>
            <div class="hypatia-lead-detail">
              ${lead.title ? `<span class="hypatia-lead-title-inline">${escapeHtml(lead.title)}</span>` : ''}
              ${lead.title && lead.company ? '<span class="hypatia-lead-separator">at</span>' : ''}
              ${lead.company ? `<span class="hypatia-lead-company-inline">${escapeHtml(lead.company)}</span>` : ''}
            </div>
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
}

function getEmptyLeadsHtml() {
  return `
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
      <p class="hypatia-empty-desc">
        Use the search above to generate leads based on your criteria
      </p>
    </div>
  `;
}

// =============================================================================
// GENERATING STATE SCREEN
// =============================================================================

function getLeadsGeneratingHtml() {
  return `
    <div class="hypatia-leads-generating">
      <div class="hypatia-spinner"></div>
      <h4>Finding leads...</h4>
      <p>Searching for people matching your criteria</p>
    </div>
  `;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================================================
// EMAIL PLACEHOLDER ANIMATION
// =============================================================================

function startEmailPlaceholderAnimation() {
  // Clear any existing animation
  stopEmailPlaceholderAnimation();

  const input = document.getElementById('hypatia-manual-email');
  if (!input) return;

  let currentIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let currentEmail = EXAMPLE_EMAILS[currentIndex];

  function animate() {
    if (!document.getElementById('hypatia-manual-email')) {
      // Input no longer in DOM, stop animation
      stopEmailPlaceholderAnimation();
      return;
    }

    // Don't animate if user has typed something
    if (input.value.length > 0) {
      input.placeholder = 'Enter email address';
      return;
    }

    if (!isDeleting) {
      // Typing
      charIndex++;
      input.placeholder = currentEmail.substring(0, charIndex);

      if (charIndex === currentEmail.length) {
        // Finished typing, pause then start deleting
        isDeleting = true;
        emailPlaceholderInterval = setTimeout(animate, 2000); // Pause at full email
        return;
      }
    } else {
      // Deleting
      charIndex--;
      input.placeholder = currentEmail.substring(0, charIndex);

      if (charIndex === 0) {
        // Finished deleting, move to next email
        isDeleting = false;
        currentIndex = (currentIndex + 1) % EXAMPLE_EMAILS.length;
        currentEmail = EXAMPLE_EMAILS[currentIndex];
        emailPlaceholderInterval = setTimeout(animate, 500); // Pause before typing next
        return;
      }
    }

    // Typing is faster than deleting
    const delay = isDeleting ? 30 : 50;
    emailPlaceholderInterval = setTimeout(animate, delay);
  }

  // Start the animation
  animate();
}

function stopEmailPlaceholderAnimation() {
  if (emailPlaceholderInterval) {
    clearTimeout(emailPlaceholderInterval);
    emailPlaceholderInterval = null;
  }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

function attachLeadsListeners() {
  const backBtn = document.getElementById('hypatia-back-to-campaign');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (typeof handleBackToCampaignDetail === 'function') {
        handleBackToCampaignDetail(leadsCampaign);
      }
    });
  }

  const generateBtn = document.getElementById('hypatia-generate-leads');
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      const query = document.getElementById('hypatia-leads-query')?.value?.trim();
      if (query && typeof handleGenerateLeads === 'function') {
        handleGenerateLeads(leadsCampaign, query);
      }
    });
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

  // Select all
  const selectAllBtn = document.getElementById('hypatia-select-all');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.hypatia-lead-check');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      updateSelectedCount();
    });
  }

  // Individual checkboxes
  const checkboxes = document.querySelectorAll('.hypatia-lead-check');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', updateSelectedCount);
  });

  // Save leads button - saves selected leads and returns to campaign detail
  const saveLeadsBtn = document.getElementById('hypatia-save-leads');
  if (saveLeadsBtn) {
    saveLeadsBtn.addEventListener('click', () => {
      const selectedLeads = getSelectedLeads();
      if (typeof handleSaveLeadsAndReturn === 'function') {
        handleSaveLeadsAndReturn(leadsCampaign, selectedLeads);
      }
    });
  }

  // Remove buttons
  const removeButtons = document.querySelectorAll('.hypatia-btn-remove');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      if (typeof handleRemoveLead === 'function') {
        handleRemoveLead(idx);
      }
    });
  });

  // Manual lead entry - Add button
  const addManualBtn = document.getElementById('hypatia-add-manual-lead');
  const manualFirstNameInput = document.getElementById('hypatia-manual-first-name');
  const manualLastNameInput = document.getElementById('hypatia-manual-last-name');
  const manualEmailInput = document.getElementById('hypatia-manual-email');

  if (addManualBtn) {
    addManualBtn.addEventListener('click', handleAddManualLead);
  }

  // Manual lead entry - Enter key on all input fields
  const manualInputs = [manualFirstNameInput, manualLastNameInput, manualEmailInput];
  manualInputs.forEach(input => {
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddManualLead();
        }
      });
    }
  });

  // Email placeholder animation (removed since we now have separate first/last name fields)
  // The email field no longer needs the animated placeholder

  // Initial count
  updateSelectedCount();
}

function updateSelectedCount() {
  const checkboxes = document.querySelectorAll('.hypatia-lead-check:checked');
  const countEl = document.getElementById('hypatia-selected-count');
  if (countEl) {
    countEl.textContent = checkboxes.length;
  }
}

function getSelectedLeads() {
  const checkboxes = document.querySelectorAll('.hypatia-lead-check:checked');
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));
  return indices.map(idx => leadsForCampaign[idx]).filter(Boolean);
}

function handleAddManualLead() {
  const firstNameInput = document.getElementById('hypatia-manual-first-name');
  const lastNameInput = document.getElementById('hypatia-manual-last-name');
  const emailInput = document.getElementById('hypatia-manual-email');

  if (!firstNameInput || !lastNameInput || !emailInput) return;

  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();
  const email = emailInput.value.trim();

  // Validate first name is required
  if (!firstName) {
    firstNameInput.classList.add('hypatia-input-error');
    setTimeout(() => firstNameInput.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Validate last name is required
  if (!lastName) {
    lastNameInput.classList.add('hypatia-input-error');
    setTimeout(() => lastNameInput.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Validate email is required
  if (!email) {
    emailInput.classList.add('hypatia-input-error');
    setTimeout(() => emailInput.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    emailInput.classList.add('hypatia-input-error');
    setTimeout(() => emailInput.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Check for duplicate email
  const isDuplicate = leadsForCampaign.some(lead => lead.email?.toLowerCase() === email.toLowerCase());
  if (isDuplicate) {
    emailInput.classList.add('hypatia-input-error');
    setTimeout(() => emailInput.classList.remove('hypatia-input-error'), 2000);
    return;
  }

  // Create the manual lead object with first and last name
  const manualLead = {
    email: email,
    name: `${firstName} ${lastName}`,
    first_name: firstName,
    last_name: lastName,
    title: '',
    company: '',
    source: 'manual'
  };

  // Add to the leads array
  leadsForCampaign.push(manualLead);

  // Clear all inputs
  firstNameInput.value = '';
  lastNameInput.value = '';
  emailInput.value = '';

  // Re-render the leads list
  const leadsListContainer = document.querySelector('.hypatia-leads-section');
  if (leadsListContainer && leadsCampaign) {
    // Update the campaign reference
    leadsCampaign.leads = leadsForCampaign;

    // Re-render the entire screen to update UI - this keeps us on the leads screen
    if (typeof updatePanelContent === 'function') {
      updatePanelContent();
    } else {
      // Fallback: just update the leads list part
      const listWrapper = leadsListContainer.querySelector('.hypatia-leads-list, .hypatia-leads-empty');
      if (listWrapper) {
        listWrapper.outerHTML = getLeadsListHtml(leadsForCampaign);
        // Re-attach listeners for the new elements
        attachLeadsListeners();
      }
    }
  }
}

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getLeadsScreen, attachLeadsListeners, getLeadsGeneratingHtml };
}
