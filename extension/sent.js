// Hypatia Sent Emails Screen
// Track and manage sent emails with delivery status and metrics

// =============================================================================
// SENT STATE
// =============================================================================

let sentCampaign = null;
let sentEmails = [];
let sentFilter = 'all'; // all, delivered, opened, replied, bounced

// =============================================================================
// SENT SCREEN
// =============================================================================

function getSentScreen(campaign = null) {
  sentCampaign = campaign;

  // If campaign provided, show campaign-specific sent emails
  // Otherwise, show all sent emails (global view)
  sentEmails = campaign?.sent_emails || getSampleSentEmails();

  const stats = calculateStats(sentEmails);
  const isGlobalView = !campaign;

  return `
    <div class="hypatia-step hypatia-sent-screen">
      <!-- Header -->
      <div class="hypatia-detail-header">
        <button class="hypatia-back-btn" id="hypatia-back-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>${isGlobalView ? 'Back to Campaigns' : 'Back to Campaign'}</span>
        </button>
      </div>

      <!-- Title -->
      <div class="hypatia-sent-hero">
        <div class="hypatia-page-badge">Tracking</div>
        <h1 class="hypatia-page-title">${isGlobalView ? 'All Sent Emails' : 'Sent Emails'}</h1>
        ${!isGlobalView ? `
          <p class="hypatia-page-subtitle">
            Tracking emails for: <strong>${escapeHtml(campaign.representative_subject || 'this campaign')}</strong>
          </p>
        ` : ''}
      </div>

      <!-- Stats Overview -->
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

      <!-- Filters -->
      <div class="hypatia-sent-filters">
        <div class="hypatia-filter-tabs">
          <button class="hypatia-filter-tab ${sentFilter === 'all' ? 'active' : ''}" data-filter="all">
            All (${stats.total})
          </button>
          <button class="hypatia-filter-tab ${sentFilter === 'delivered' ? 'active' : ''}" data-filter="delivered">
            Delivered (${stats.delivered})
          </button>
          <button class="hypatia-filter-tab ${sentFilter === 'opened' ? 'active' : ''}" data-filter="opened">
            Opened (${stats.opened})
          </button>
          <button class="hypatia-filter-tab ${sentFilter === 'replied' ? 'active' : ''}" data-filter="replied">
            Replied (${stats.replied})
          </button>
          <button class="hypatia-filter-tab ${sentFilter === 'bounced' ? 'active' : ''}" data-filter="bounced">
            Bounced (${stats.bounced})
          </button>
        </div>

        <div class="hypatia-filter-actions">
          <button class="hypatia-btn-icon" id="hypatia-export-sent" title="Export to CSV">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button class="hypatia-btn-icon" id="hypatia-refresh-sent" title="Refresh">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Sent Emails List -->
      <div class="hypatia-sent-list-container">
        ${sentEmails.length > 0 ? getSentListHtml(sentEmails, sentFilter) : getEmptySentHtml()}
      </div>

    </div>
  `;
}

function getSentListHtml(emails, filter = 'all') {
  const filteredEmails = filterEmails(emails, filter);

  if (filteredEmails.length === 0) {
    return `
      <div class="hypatia-sent-empty-filter">
        <p>No emails match this filter</p>
      </div>
    `;
  }

  return `
    <div class="hypatia-sent-list">
      ${filteredEmails.map((email, idx) => `
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
          <div class="hypatia-sent-subject">
            ${escapeHtml(email.subject || 'No subject')}
          </div>
          <div class="hypatia-sent-meta">
            <div class="hypatia-sent-date">${formatDate(email.sent_at)}</div>
            ${email.opened_at ? `<div class="hypatia-sent-opened">Opened ${formatDate(email.opened_at)}</div>` : ''}
          </div>
          <div class="hypatia-sent-actions">
            <button class="hypatia-btn-icon hypatia-btn-view" data-idx="${idx}" title="View details">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            ${email.status !== 'replied' ? `
              <button class="hypatia-btn-icon hypatia-btn-followup" data-idx="${idx}" title="Send follow-up">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 17 4 12 9 7"/>
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function getEmptySentHtml() {
  return `
    <div class="hypatia-sent-empty">
      <div class="hypatia-empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </div>
      <h4 class="hypatia-empty-title">No emails sent yet</h4>
      <p class="hypatia-empty-desc">
        Emails sent through Hypatia will appear here with tracking information
      </p>
    </div>
  `;
}

// =============================================================================
// EMAIL DETAIL MODAL
// =============================================================================

function getEmailDetailModal(email) {
  return `
    <div class="hypatia-modal-overlay" id="hypatia-email-modal">
      <div class="hypatia-modal">
        <div class="hypatia-modal-header">
          <h3>Email Details</h3>
          <button class="hypatia-modal-close" id="hypatia-close-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="hypatia-modal-body">
          <div class="hypatia-email-detail-row">
            <span class="hypatia-detail-label">To:</span>
            <span class="hypatia-detail-value">${escapeHtml(email.recipient_name)} &lt;${escapeHtml(email.recipient_email)}&gt;</span>
          </div>
          <div class="hypatia-email-detail-row">
            <span class="hypatia-detail-label">Subject:</span>
            <span class="hypatia-detail-value">${escapeHtml(email.subject)}</span>
          </div>
          <div class="hypatia-email-detail-row">
            <span class="hypatia-detail-label">Sent:</span>
            <span class="hypatia-detail-value">${formatDateTime(email.sent_at)}</span>
          </div>
          <div class="hypatia-email-detail-row">
            <span class="hypatia-detail-label">Status:</span>
            <span class="hypatia-detail-value hypatia-status-${email.status}">${capitalizeFirst(email.status)}</span>
          </div>
          ${email.opened_at ? `
            <div class="hypatia-email-detail-row">
              <span class="hypatia-detail-label">Opened:</span>
              <span class="hypatia-detail-value">${formatDateTime(email.opened_at)}</span>
            </div>
          ` : ''}
          ${email.replied_at ? `
            <div class="hypatia-email-detail-row">
              <span class="hypatia-detail-label">Replied:</span>
              <span class="hypatia-detail-value">${formatDateTime(email.replied_at)}</span>
            </div>
          ` : ''}
          <div class="hypatia-email-detail-body">
            <span class="hypatia-detail-label">Message:</span>
            <div class="hypatia-detail-body-content">
              ${escapeHtml(email.body || 'No preview available').replace(/\n/g, '<br>')}
            </div>
          </div>
        </div>
        <div class="hypatia-modal-footer">
          ${email.status !== 'replied' ? `
            <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-send-followup">
              Send Follow-up
            </button>
          ` : ''}
          <button class="hypatia-btn hypatia-btn-primary" id="hypatia-view-in-gmail">
            View in Gmail
          </button>
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

function calculateStats(emails) {
  return {
    total: emails.length,
    delivered: emails.filter(e => e.status !== 'bounced' && e.status !== 'pending').length,
    opened: emails.filter(e => e.opened_at || e.status === 'opened' || e.status === 'replied').length,
    replied: emails.filter(e => e.status === 'replied').length,
    bounced: emails.filter(e => e.status === 'bounced').length
  };
}

function filterEmails(emails, filter) {
  if (filter === 'all') return emails;
  if (filter === 'delivered') return emails.filter(e => e.status !== 'bounced' && e.status !== 'pending');
  if (filter === 'opened') return emails.filter(e => e.opened_at || e.status === 'opened' || e.status === 'replied');
  if (filter === 'replied') return emails.filter(e => e.status === 'replied');
  if (filter === 'bounced') return emails.filter(e => e.status === 'bounced');
  return emails;
}

function getStatusIcon(status) {
  switch (status) {
    case 'delivered':
      return `<div class="hypatia-status-icon hypatia-status-delivered" title="Delivered">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>`;
    case 'opened':
      return `<div class="hypatia-status-icon hypatia-status-opened" title="Opened">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>`;
    case 'replied':
      return `<div class="hypatia-status-icon hypatia-status-replied" title="Replied">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 17 4 12 9 7"/>
          <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
      </div>`;
    case 'bounced':
      return `<div class="hypatia-status-icon hypatia-status-bounced" title="Bounced">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      </div>`;
    default:
      return `<div class="hypatia-status-icon hypatia-status-pending" title="Pending">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>`;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getSampleSentEmails() {
  // Sample data for display purposes
  return [
    {
      recipient_name: 'Sarah Johnson',
      recipient_email: 'sarah@techstartup.com',
      subject: 'Quick question about your product',
      status: 'replied',
      sent_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      opened_at: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString(),
      replied_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi Sarah,\n\nI wanted to reach out regarding your new product launch...'
    },
    {
      recipient_name: 'Mike Chen',
      recipient_email: 'mike@enterprise.co',
      subject: 'Partnership opportunity',
      status: 'opened',
      sent_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      opened_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi Mike,\n\nI hope this email finds you well...'
    },
    {
      recipient_name: 'Emily Davis',
      recipient_email: 'emily@startup.io',
      subject: 'Following up on our conversation',
      status: 'delivered',
      sent_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi Emily,\n\nGreat meeting you at the conference...'
    },
    {
      recipient_name: 'John Smith',
      recipient_email: 'john@invalid-domain-xyz.com',
      subject: 'Introduction',
      status: 'bounced',
      sent_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      body: 'Hi John,\n\nI wanted to introduce myself...'
    }
  ];
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

function attachSentListeners() {
  const backBtn = document.getElementById('hypatia-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (sentCampaign) {
        if (typeof handleBackToCampaignDetail === 'function') {
          handleBackToCampaignDetail(sentCampaign);
        }
      } else {
        if (typeof handleBackToCampaigns === 'function') {
          handleBackToCampaigns();
        }
      }
    });
  }

  // Filter tabs
  const filterTabs = document.querySelectorAll('.hypatia-filter-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sentFilter = tab.dataset.filter;
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const listContainer = document.querySelector('.hypatia-sent-list-container');
      if (listContainer) {
        listContainer.innerHTML = getSentListHtml(sentEmails, sentFilter);
        attachSentRowListeners();
      }
    });
  });

  // Export button
  const exportBtn = document.getElementById('hypatia-export-sent');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (typeof handleExportSent === 'function') {
        handleExportSent(sentEmails);
      }
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('hypatia-refresh-sent');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (typeof handleRefreshSent === 'function') {
        handleRefreshSent(sentCampaign);
      }
    });
  }

  attachSentRowListeners();
}

function attachSentRowListeners() {
  // View buttons
  const viewButtons = document.querySelectorAll('.hypatia-btn-view');
  viewButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      showEmailDetail(sentEmails[idx]);
    });
  });

  // Follow-up buttons
  const followupButtons = document.querySelectorAll('.hypatia-btn-followup');
  followupButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      if (typeof handleSendFollowup === 'function') {
        handleSendFollowup(sentEmails[idx]);
      }
    });
  });

  // Row clicks
  const rows = document.querySelectorAll('.hypatia-sent-row');
  rows.forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.emailIdx);
      showEmailDetail(sentEmails[idx]);
    });
  });
}

function showEmailDetail(email) {
  const modalHtml = getEmailDetailModal(email);
  const modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer.firstElementChild);

  // Close button
  document.getElementById('hypatia-close-modal')?.addEventListener('click', closeEmailModal);

  // Overlay click
  document.getElementById('hypatia-email-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'hypatia-email-modal') {
      closeEmailModal();
    }
  });

  // View in Gmail button
  document.getElementById('hypatia-view-in-gmail')?.addEventListener('click', () => {
    if (typeof handleViewInGmail === 'function') {
      handleViewInGmail(email);
    }
    closeEmailModal();
  });
}

function closeEmailModal() {
  const modal = document.getElementById('hypatia-email-modal');
  if (modal) {
    modal.remove();
  }
}

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSentScreen, attachSentListeners };
}
