// Hypatia Template Screen
// Create and preview email templates based on CTA and writing style

// =============================================================================
// TEMPLATE STATE
// =============================================================================

let templateCampaign = null;
let templateLeads = [];
let currentTemplate = {
  subject: '',
  body: ''
};
let previewLeadIndex = 0;

// =============================================================================
// TEMPLATE SCREEN
// =============================================================================

function getTemplateScreen(campaign, leads = []) {
  templateCampaign = campaign;
  templateLeads = leads.length > 0 ? leads : (campaign.leads || []);

  // Pre-populate template based on campaign style
  if (!currentTemplate.subject && campaign) {
    currentTemplate.subject = campaign.template?.subject || generateSubjectFromCampaign(campaign);
    currentTemplate.body = campaign.template?.body || generateBodyFromCampaign(campaign);
  }

  const hasLeads = templateLeads.length > 0;
  const previewLead = templateLeads[previewLeadIndex] || getSampleLead();

  return `
    <div class="hypatia-step hypatia-template-screen">
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
      <div class="hypatia-template-hero">
        <div class="hypatia-page-badge">Template</div>
        <h1 class="hypatia-page-title">Email Template</h1>
        <p class="hypatia-page-subtitle">
          Customize your email for: <strong>${escapeHtml(campaign.representative_subject || 'this campaign')}</strong>
        </p>
      </div>

      <!-- Template Editor & Preview Container -->
      <div class="hypatia-template-container">

        <!-- Editor Panel -->
        <div class="hypatia-template-editor">
          <h3 class="hypatia-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit Template
          </h3>

          <!-- Subject Line -->
          <div class="hypatia-template-field">
            <label class="hypatia-input-label">Subject Line</label>
            <input
              type="text"
              class="hypatia-input hypatia-template-subject"
              id="hypatia-template-subject"
              value="${escapeHtml(currentTemplate.subject)}"
              placeholder="Enter email subject..."
            />
          </div>

          <!-- Body -->
          <div class="hypatia-template-field">
            <label class="hypatia-input-label">Email Body</label>
            <textarea
              class="hypatia-textarea hypatia-template-body"
              id="hypatia-template-body"
              rows="12"
              placeholder="Write your email here..."
            >${escapeHtml(currentTemplate.body)}</textarea>
          </div>

          <!-- Variables Help -->
          <div class="hypatia-variables-help">
            <span class="hypatia-variables-label">Available variables:</span>
            <div class="hypatia-variable-chips">
              <button class="hypatia-variable-chip" data-var="{{first_name}}">{{first_name}}</button>
              <button class="hypatia-variable-chip" data-var="{{last_name}}">{{last_name}}</button>
              <button class="hypatia-variable-chip" data-var="{{company}}">{{company}}</button>
              <button class="hypatia-variable-chip" data-var="{{title}}">{{title}}</button>
              <button class="hypatia-variable-chip" data-var="{{email}}">{{email}}</button>
            </div>
            <p class="hypatia-variables-hint">Click to insert at cursor position</p>
          </div>

          <!-- Style Info -->
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

        <!-- Preview Panel -->
        <div class="hypatia-template-preview">
          <div class="hypatia-preview-header">
            <h3 class="hypatia-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Live Preview
            </h3>
            ${hasLeads ? `
              <div class="hypatia-preview-nav">
                <button class="hypatia-btn-icon" id="hypatia-prev-preview" ${previewLeadIndex === 0 ? 'disabled' : ''}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                <span class="hypatia-preview-count">${previewLeadIndex + 1} / ${templateLeads.length}</span>
                <button class="hypatia-btn-icon" id="hypatia-next-preview" ${previewLeadIndex >= templateLeads.length - 1 ? 'disabled' : ''}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>
              </div>
            ` : ''}
          </div>

          <!-- Email Preview -->
          <div class="hypatia-email-preview">
            <div class="hypatia-email-preview-header">
              <div class="hypatia-email-to">
                <span class="hypatia-email-label">To:</span>
                <span class="hypatia-email-value">${escapeHtml(previewLead.name || 'John Doe')} &lt;${escapeHtml(previewLead.email || 'john@example.com')}&gt;</span>
              </div>
              <div class="hypatia-email-subject">
                <span class="hypatia-email-label">Subject:</span>
                <span class="hypatia-email-value" id="hypatia-preview-subject">${escapeHtml(replaceVariables(currentTemplate.subject, previewLead))}</span>
              </div>
            </div>
            <div class="hypatia-email-preview-body" id="hypatia-preview-body">
              ${escapeHtml(replaceVariables(currentTemplate.body, previewLead)).replace(/\n/g, '<br>')}
            </div>
          </div>

          <!-- Preview Lead Info -->
          ${hasLeads ? `
            <div class="hypatia-preview-lead-info">
              <div class="hypatia-preview-lead-avatar">
                ${previewLead.name ? previewLead.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div class="hypatia-preview-lead-details">
                <div class="hypatia-preview-lead-name">${escapeHtml(previewLead.name || 'Unknown')}</div>
                <div class="hypatia-preview-lead-meta">
                  ${previewLead.title ? escapeHtml(previewLead.title) : ''}
                  ${previewLead.title && previewLead.company ? ' at ' : ''}
                  ${previewLead.company ? escapeHtml(previewLead.company) : ''}
                </div>
              </div>
            </div>
          ` : `
            <div class="hypatia-preview-sample-notice">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Using sample data for preview
            </div>
          `}
        </div>

      </div>

      <!-- Footer Actions -->
      <div class="hypatia-template-footer">
        <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-regenerate-template">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Regenerate with AI
        </button>
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-save-and-continue">
          Save & Continue to Send
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

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

function getSampleLead() {
  return {
    name: 'John Doe',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    company: 'Acme Inc',
    title: 'CEO'
  };
}

function generateSubjectFromCampaign(campaign) {
  // Generate a subject line based on campaign CTA
  if (campaign.cta_type) {
    return `Quick question, {{first_name}}`;
  }
  return campaign.representative_subject || 'Following up';
}

function generateBodyFromCampaign(campaign) {
  // Generate email body based on campaign style and CTA
  const greeting = 'Hi {{first_name}},\n\n';

  let body = '';
  if (campaign.cta_description) {
    body = `I wanted to reach out regarding ${campaign.cta_description.toLowerCase()}.\n\n`;
  } else {
    body = 'I hope this email finds you well.\n\n';
  }

  if (campaign.style_description && campaign.style_description.toLowerCase().includes('casual')) {
    body += 'Would love to chat if you have a few minutes this week.\n\n';
    body += 'Best,\n[Your name]';
  } else {
    body += 'I would appreciate the opportunity to discuss this further at your convenience.\n\n';
    body += 'Best regards,\n[Your name]';
  }

  return greeting + body;
}

function replaceVariables(text, lead) {
  if (!text || !lead) return text;

  // Parse first/last name from full name if needed
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
// EVENT HANDLERS
// =============================================================================

function attachTemplateListeners() {
  const backBtn = document.getElementById('hypatia-back-to-campaign');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (typeof handleBackToCampaignDetail === 'function') {
        handleBackToCampaignDetail(templateCampaign);
      }
    });
  }

  // Live preview updates
  const subjectInput = document.getElementById('hypatia-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body');

  if (subjectInput) {
    subjectInput.addEventListener('input', updatePreview);
  }

  if (bodyInput) {
    bodyInput.addEventListener('input', updatePreview);
  }

  // Variable chips
  const variableChips = document.querySelectorAll('.hypatia-variable-chip');
  variableChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const variable = chip.dataset.var;
      insertVariableAtCursor(variable);
    });
  });

  // Preview navigation
  const prevBtn = document.getElementById('hypatia-prev-preview');
  const nextBtn = document.getElementById('hypatia-next-preview');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (previewLeadIndex > 0) {
        previewLeadIndex--;
        refreshPreviewLead();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (previewLeadIndex < templateLeads.length - 1) {
        previewLeadIndex++;
        refreshPreviewLead();
      }
    });
  }

  // Regenerate button
  const regenerateBtn = document.getElementById('hypatia-regenerate-template');
  if (regenerateBtn) {
    regenerateBtn.addEventListener('click', () => {
      if (typeof handleRegenerateTemplate === 'function') {
        handleRegenerateTemplate(templateCampaign);
      }
    });
  }

  // Save and continue
  const saveBtn = document.getElementById('hypatia-save-and-continue');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveCurrentTemplate();
      if (typeof handleSaveAndContinueToSend === 'function') {
        handleSaveAndContinueToSend(templateCampaign, currentTemplate, templateLeads);
      }
    });
  }
}

function updatePreview() {
  const subjectInput = document.getElementById('hypatia-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body');
  const previewSubject = document.getElementById('hypatia-preview-subject');
  const previewBody = document.getElementById('hypatia-preview-body');

  currentTemplate.subject = subjectInput?.value || '';
  currentTemplate.body = bodyInput?.value || '';

  const previewLead = templateLeads[previewLeadIndex] || getSampleLead();

  if (previewSubject) {
    previewSubject.textContent = replaceVariables(currentTemplate.subject, previewLead);
  }

  if (previewBody) {
    previewBody.innerHTML = escapeHtml(replaceVariables(currentTemplate.body, previewLead)).replace(/\n/g, '<br>');
  }
}

function refreshPreviewLead() {
  const previewLead = templateLeads[previewLeadIndex] || getSampleLead();

  // Update preview count
  const countEl = document.querySelector('.hypatia-preview-count');
  if (countEl) {
    countEl.textContent = `${previewLeadIndex + 1} / ${templateLeads.length}`;
  }

  // Update nav buttons
  const prevBtn = document.getElementById('hypatia-prev-preview');
  const nextBtn = document.getElementById('hypatia-next-preview');
  if (prevBtn) prevBtn.disabled = previewLeadIndex === 0;
  if (nextBtn) nextBtn.disabled = previewLeadIndex >= templateLeads.length - 1;

  // Update lead info
  const avatar = document.querySelector('.hypatia-preview-lead-avatar');
  const name = document.querySelector('.hypatia-preview-lead-name');
  const meta = document.querySelector('.hypatia-preview-lead-meta');
  const toField = document.querySelector('.hypatia-email-to .hypatia-email-value');

  if (avatar) avatar.textContent = previewLead.name ? previewLead.name.charAt(0).toUpperCase() : '?';
  if (name) name.textContent = previewLead.name || 'Unknown';
  if (meta) {
    let metaText = previewLead.title || '';
    if (previewLead.title && previewLead.company) metaText += ' at ';
    metaText += previewLead.company || '';
    meta.textContent = metaText;
  }
  if (toField) {
    toField.textContent = `${previewLead.name || 'Unknown'} <${previewLead.email || 'unknown@example.com'}>`;
  }

  // Update preview content
  updatePreview();
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

  updatePreview();
}

function saveCurrentTemplate() {
  const subjectInput = document.getElementById('hypatia-template-subject');
  const bodyInput = document.getElementById('hypatia-template-body');

  currentTemplate.subject = subjectInput?.value || '';
  currentTemplate.body = bodyInput?.value || '';
}

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getTemplateScreen, attachTemplateListeners };
}
