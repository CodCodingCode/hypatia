// Hypatia Leads Screen
// Generate and manage leads for a campaign using natural language

// =============================================================================
// LEADS STATE
// =============================================================================

let leadsForCampaign = [];
let leadsCampaign = null;

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
            placeholder="e.g., Find me 50 CTOs at YC-backed startups in San Francisco, or Marketing directors at e-commerce companies with 50-200 employees..."
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
        <p class="hypatia-input-hint">
          Be specific about role, company type, location, or any other criteria
        </p>
      </div>

      <!-- Quick Suggestions -->
      <div class="hypatia-leads-suggestions">
        <span class="hypatia-suggestions-label">Quick suggestions:</span>
        <div class="hypatia-suggestion-chips">
          <button class="hypatia-chip" data-query="50 startup founders in my network">Startup founders</button>
          <button class="hypatia-chip" data-query="Marketing managers at SaaS companies">Marketing managers</button>
          <button class="hypatia-chip" data-query="VCs and angel investors">Investors</button>
          <button class="hypatia-chip" data-query="Engineering leads at tech companies">Engineering leads</button>
        </div>
      </div>

      <!-- Leads List -->
      <div class="hypatia-leads-section">
        <div class="hypatia-leads-header">
          <h3 class="hypatia-section-title">
            ${hasLeads ? `Generated Leads (${leadsForCampaign.length})` : 'Your Leads'}
          </h3>
          ${hasLeads ? `
            <div class="hypatia-leads-actions">
              <button class="hypatia-btn-icon" id="hypatia-select-all" title="Select all">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 11 12 14 22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </button>
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
      </div>

      <!-- Footer Actions -->
      ${hasLeads ? `
        <div class="hypatia-leads-footer">
          <div class="hypatia-leads-selected-count">
            <span id="hypatia-selected-count">0</span> of ${leadsForCampaign.length} selected
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

  // Continue button
  const continueBtn = document.getElementById('hypatia-continue-to-template');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const selectedLeads = getSelectedLeads();
      if (typeof handleContinueToTemplate === 'function') {
        handleContinueToTemplate(leadsCampaign, selectedLeads);
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

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getLeadsScreen, attachLeadsListeners, getLeadsGeneratingHtml };
}
