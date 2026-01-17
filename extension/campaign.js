// Hypatia Campaign Detail Screen
// Shows detailed view of a single campaign with leads, template, and actions

// =============================================================================
// CAMPAIGN DETAIL STATE
// =============================================================================

let currentCampaign = null;

// =============================================================================
// CAMPAIGN DETAIL SCREEN
// =============================================================================

function getCampaignDetailScreen(campaign) {
  currentCampaign = campaign;

  // Sample data for display
  const leadsCount = campaign.leads?.length || 0;
  const sentCount = campaign.sent_count || 0;
  const templateExists = campaign.template ? true : false;

  return `
    <div class="hypatia-step hypatia-campaign-detail">
      <!-- Header with back button -->
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-to-campaigns">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>Back to Campaigns</span>
        </button>
      </div>

      <!-- Campaign Title & Meta -->
      <div class="hypatia-campaign-hero">
        <div class="hypatia-campaign-badge">Campaign</div>
        <h1 class="hypatia-campaign-title">${escapeHtml(campaign.representative_subject || 'Untitled Campaign')}</h1>
        <p class="hypatia-campaign-recipient-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          ${escapeHtml(campaign.contact_description || campaign.representative_recipient || 'Unknown contacts')}
        </p>
      </div>

      <!-- Stats Row -->
      <div class="hypatia-campaign-stats">
        <div class="hypatia-stat-card">
          <div class="hypatia-stat-value">${campaign.email_count || 0}</div>
          <div class="hypatia-stat-label">Historical Emails</div>
        </div>
        <div class="hypatia-stat-card">
          <div class="hypatia-stat-value">${leadsCount}</div>
          <div class="hypatia-stat-label">Leads Generated</div>
        </div>
        <div class="hypatia-stat-card">
          <div class="hypatia-stat-value">${sentCount}</div>
          <div class="hypatia-stat-label">Emails Sent</div>
        </div>
        <div class="hypatia-stat-card">
          <div class="hypatia-stat-value">${campaign.avg_similarity ? Math.round(campaign.avg_similarity * 100) + '%' : 'N/A'}</div>
          <div class="hypatia-stat-label">Similarity Score</div>
        </div>
      </div>

      <!-- Campaign Analysis Section -->
      <div class="hypatia-detail-section">
        <h3 class="hypatia-section-title">Campaign Analysis</h3>
        <div class="hypatia-analysis-cards">
          ${campaign.style_description ? `
            <div class="hypatia-analysis-card">
              <div class="hypatia-analysis-card-icon hypatia-icon-style">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                  <path d="M2 2l7.586 7.586"/>
                </svg>
              </div>
              <div class="hypatia-analysis-card-content">
                <div class="hypatia-analysis-card-label">Writing Style</div>
                <div class="hypatia-analysis-card-value">${escapeHtml(campaign.style_description)}</div>
              </div>
            </div>
          ` : ''}

          ${campaign.cta_type ? `
            <div class="hypatia-analysis-card">
              <div class="hypatia-analysis-card-icon hypatia-icon-cta">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <div class="hypatia-analysis-card-content">
                <div class="hypatia-analysis-card-label">Call to Action</div>
                <div class="hypatia-analysis-card-value">
                  ${escapeHtml(campaign.cta_description || campaign.cta_type)}
                  ${campaign.cta_urgency ? `<span class="hypatia-urgency-badge hypatia-urgency-${campaign.cta_urgency}">${campaign.cta_urgency}</span>` : ''}
                </div>
              </div>
            </div>
          ` : ''}

          ${campaign.contact_description ? `
            <div class="hypatia-analysis-card">
              <div class="hypatia-analysis-card-icon hypatia-icon-contact">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div class="hypatia-analysis-card-content">
                <div class="hypatia-analysis-card-label">Target Contacts</div>
                <div class="hypatia-analysis-card-value">${escapeHtml(campaign.contact_description)}</div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Action Cards -->
      <div class="hypatia-detail-section">
        <h3 class="hypatia-section-title">Continue Campaign</h3>
        <div class="hypatia-action-cards">

          <!-- Leads Card -->
          <div class="hypatia-action-card" id="hypatia-goto-leads">
            <div class="hypatia-action-card-icon hypatia-icon-leads">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div class="hypatia-action-card-content">
              <div class="hypatia-action-card-title">Generate Leads</div>
              <div class="hypatia-action-card-desc">Find people to contact using natural language</div>
              <div class="hypatia-action-card-status">
                ${leadsCount > 0 ? `<span class="hypatia-status-badge hypatia-status-done">${leadsCount} leads ready</span>` : '<span class="hypatia-status-badge hypatia-status-pending">Not started</span>'}
              </div>
            </div>
            <div class="hypatia-action-card-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </div>

          <!-- Template Card -->
          <div class="hypatia-action-card" id="hypatia-goto-template">
            <div class="hypatia-action-card-icon hypatia-icon-template">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div class="hypatia-action-card-content">
              <div class="hypatia-action-card-title">Email Template</div>
              <div class="hypatia-action-card-desc">Create personalized email based on your style</div>
              <div class="hypatia-action-card-status">
                ${templateExists ? '<span class="hypatia-status-badge hypatia-status-done">Template ready</span>' : '<span class="hypatia-status-badge hypatia-status-pending">Not created</span>'}
              </div>
            </div>
            <div class="hypatia-action-card-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </div>

          <!-- Send Card -->
          <div class="hypatia-action-card ${!templateExists || leadsCount === 0 ? 'hypatia-action-disabled' : ''}" id="hypatia-goto-send">
            <div class="hypatia-action-card-icon hypatia-icon-send">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </div>
            <div class="hypatia-action-card-content">
              <div class="hypatia-action-card-title">Send Emails</div>
              <div class="hypatia-action-card-desc">Review and send to all your leads</div>
              <div class="hypatia-action-card-status">
                ${sentCount > 0 ? `<span class="hypatia-status-badge hypatia-status-sent">${sentCount} sent</span>` : '<span class="hypatia-status-badge hypatia-status-pending">Ready to send</span>'}
              </div>
            </div>
            <div class="hypatia-action-card-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </div>

          <!-- Sent/Tracking Card -->
          <div class="hypatia-action-card" id="hypatia-goto-sent">
            <div class="hypatia-action-card-icon hypatia-icon-tracking">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <div class="hypatia-action-card-content">
              <div class="hypatia-action-card-title">Track Sent Emails</div>
              <div class="hypatia-action-card-desc">View delivery status and responses</div>
              <div class="hypatia-action-card-status">
                ${sentCount > 0 ? `<span class="hypatia-status-badge hypatia-status-info">${sentCount} tracked</span>` : '<span class="hypatia-status-badge hypatia-status-empty">No emails sent yet</span>'}
              </div>
            </div>
            <div class="hypatia-action-card-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </div>

        </div>
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

// =============================================================================
// EVENT HANDLERS (to be wired up in content.js)
// =============================================================================

function attachCampaignDetailListeners() {
  const backBtn = document.getElementById('hypatia-back-to-campaigns');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // Navigate back to campaigns list
      // This will be handled by content.js
      if (typeof handleBackToCampaigns === 'function') {
        handleBackToCampaigns();
      }
    });
  }

  const leadsCard = document.getElementById('hypatia-goto-leads');
  if (leadsCard) {
    leadsCard.addEventListener('click', () => {
      if (typeof handleGotoLeads === 'function') {
        handleGotoLeads(currentCampaign);
      }
    });
  }

  const templateCard = document.getElementById('hypatia-goto-template');
  if (templateCard) {
    templateCard.addEventListener('click', () => {
      if (typeof handleGotoTemplate === 'function') {
        handleGotoTemplate(currentCampaign);
      }
    });
  }

  const sendCard = document.getElementById('hypatia-goto-send');
  if (sendCard && !sendCard.classList.contains('hypatia-action-disabled')) {
    sendCard.addEventListener('click', () => {
      if (typeof handleGotoSend === 'function') {
        handleGotoSend(currentCampaign);
      }
    });
  }

  const sentCard = document.getElementById('hypatia-goto-sent');
  if (sentCard) {
    sentCard.addEventListener('click', () => {
      if (typeof handleGotoSent === 'function') {
        handleGotoSent(currentCampaign);
      }
    });
  }
}

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getCampaignDetailScreen, attachCampaignDetailListeners };
}
