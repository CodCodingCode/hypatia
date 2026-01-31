import { useEffect, useState } from 'preact/hooks';
import { selectedCampaign, api } from '../../context/AppContext';
import { navigateBack } from '../../hooks/useNavigation';
import { Card, CardBody } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Tabs } from '../ui/Tabs';
import { LoadingScreen } from '../ui/Spinner';
import { EmptyState, EmptyIcons } from '../ui/EmptyState';

const STATUS_CONFIG = {
  delivered: { label: 'Delivered', variant: 'success', icon: '✓' },
  opened: { label: 'Opened', variant: 'primary', icon: '👁' },
  replied: { label: 'Replied', variant: 'success', icon: '↩' },
  bounced: { label: 'Bounced', variant: 'error', icon: '!' },
  pending: { label: 'Pending', variant: 'warning', icon: '○' }
};

/**
 * Sent emails screen - track email delivery and responses
 */
export function SentEmails() {
  const [isLoading, setIsLoading] = useState(true);
  const [emails, setEmails] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');

  const campaign = selectedCampaign.value;

  // Load sent emails on mount
  useEffect(() => {
    if (campaign?.id) {
      loadEmails();
    }
  }, [campaign?.id]);

  async function loadEmails() {
    try {
      setIsLoading(true);
      const data = await api.fetchSentEmails(campaign.id);
      setEmails(data);
    } catch (err) {
      console.error('[Hypatia] Failed to load sent emails:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // Calculate stats
  const stats = {
    total: emails.length,
    delivered: emails.filter(e => e.status === 'delivered' || e.status === 'opened' || e.status === 'replied').length,
    opened: emails.filter(e => e.status === 'opened' || e.status === 'replied').length,
    replied: emails.filter(e => e.status === 'replied').length,
    bounced: emails.filter(e => e.status === 'bounced').length
  };

  // Filter emails
  const filteredEmails = activeFilter === 'all'
    ? emails
    : emails.filter(e => e.status === activeFilter);

  const filterTabs = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'delivered', label: 'Delivered', count: stats.delivered },
    { id: 'opened', label: 'Opened', count: stats.opened },
    { id: 'replied', label: 'Replied', count: stats.replied },
    { id: 'bounced', label: 'Bounced', count: stats.bounced }
  ];

  if (!campaign) {
    return <LoadingScreen message="Loading..." />;
  }

  return (
    <div class="hypatia-sent-screen">
      {/* Header */}
      <header class="hypatia-screen-header">
        <div class="hypatia-screen-header__left">
          <IconButton label="Back" onClick={navigateBack}>
            <BackIcon />
          </IconButton>
          <div>
            <Badge variant="primary">Tracking</Badge>
            <h1 class="hypatia-screen-title">Sent Emails</h1>
          </div>
        </div>
        <div class="hypatia-screen-header__right">
          <Button variant="ghost" size="sm" onClick={loadEmails}>
            <RefreshIcon />
            Refresh
          </Button>
          <Button variant="secondary" size="sm">
            Export
          </Button>
        </div>
      </header>

      {/* Stats Cards */}
      <div class="hypatia-sent-stats">
        <StatCard
          label="Total Sent"
          value={stats.total}
        />
        <StatCard
          label="Delivered"
          value={stats.delivered}
          percentage={stats.total > 0 ? Math.round((stats.delivered / stats.total) * 100) : 0}
          variant="success"
        />
        <StatCard
          label="Opened"
          value={stats.opened}
          percentage={stats.delivered > 0 ? Math.round((stats.opened / stats.delivered) * 100) : 0}
          variant="primary"
        />
        <StatCard
          label="Replied"
          value={stats.replied}
          percentage={stats.opened > 0 ? Math.round((stats.replied / stats.opened) * 100) : 0}
          variant="success"
        />
        <StatCard
          label="Bounced"
          value={stats.bounced}
          percentage={stats.total > 0 ? Math.round((stats.bounced / stats.total) * 100) : 0}
          variant="error"
        />
      </div>

      {/* Filter Tabs */}
      <Tabs
        tabs={filterTabs}
        activeTab={activeFilter}
        onChange={setActiveFilter}
      />

      {/* Email List */}
      <div class="hypatia-sent-list">
        {isLoading ? (
          <LoadingScreen message="Loading emails..." />
        ) : filteredEmails.length === 0 ? (
          <EmptyState
            icon={EmptyIcons.emails}
            title="No emails yet"
            description={activeFilter === 'all'
              ? "You haven't sent any emails from this campaign yet"
              : `No ${activeFilter} emails`
            }
          />
        ) : (
          filteredEmails.map(email => (
            <EmailCard key={email.id} email={email} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Stats card component
 */
function StatCard({ label, value, percentage, variant = 'default' }) {
  return (
    <div class={`hypatia-sent-stat-card hypatia-sent-stat-card--${variant}`}>
      <div class="hypatia-sent-stat-card__value">{value}</div>
      <div class="hypatia-sent-stat-card__label">{label}</div>
      {percentage !== undefined && (
        <div class="hypatia-sent-stat-card__percentage">{percentage}%</div>
      )}
    </div>
  );
}

/**
 * Email card component
 */
function EmailCard({ email }) {
  const config = STATUS_CONFIG[email.status] || STATUS_CONFIG.pending;
  const recipientName = [email.recipient_first_name, email.recipient_last_name]
    .filter(Boolean).join(' ') || 'Unknown';

  return (
    <Card>
      <CardBody>
        <div class="hypatia-email-card">
          {/* Status Icon */}
          <div class={`hypatia-email-card__status hypatia-email-card__status--${email.status}`}>
            {config.icon}
          </div>

          {/* Recipient */}
          <Avatar name={recipientName} size="sm" />
          <div class="hypatia-email-card__recipient">
            <div class="hypatia-font-medium">{recipientName}</div>
            <div class="hypatia-text-tertiary hypatia-text-xs">{email.recipient_email}</div>
          </div>

          {/* Subject */}
          <div class="hypatia-email-card__subject hypatia-truncate">
            {email.subject}
          </div>

          {/* Dates */}
          <div class="hypatia-email-card__dates">
            <div class="hypatia-text-sm">
              <span class="hypatia-text-tertiary">Sent:</span>{' '}
              {formatDate(email.sent_at)}
            </div>
            {email.opened_at && (
              <div class="hypatia-text-sm">
                <span class="hypatia-text-tertiary">Opened:</span>{' '}
                {formatDate(email.opened_at)}
              </div>
            )}
          </div>

          {/* Badge */}
          <Badge variant={config.variant}>{config.label}</Badge>

          {/* Actions */}
          <div class="hypatia-email-card__actions">
            <IconButton label="View details" size="sm">
              <ViewIcon />
            </IconButton>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Icons
function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
