import { useEffect, useState } from 'preact/hooks';
import { campaigns, selectedCampaign, actions, api } from '../../context/AppContext';
import { navigate, navigateBack, ROUTES } from '../../hooks/useNavigation';
import { Card, CardBody } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LoadingScreen } from '../ui/Spinner';

/**
 * Campaign detail screen - shows campaign info and action cards
 */
export function CampaignDetail({ campaignId }) {
  const [isLoading, setIsLoading] = useState(false);

  // Select campaign on mount
  useEffect(() => {
    if (campaignId) {
      actions.selectCampaign(campaignId);
    }
  }, [campaignId]);

  const campaign = selectedCampaign.value;

  if (!campaign) {
    return <LoadingScreen message="Loading campaign..." />;
  }

  const hasLeads = (campaign.leads_count || 0) > 0;
  const hasTemplate = !!campaign.template_id;
  const canSend = hasLeads && hasTemplate;

  return (
    <div class="hypatia-campaign-detail-screen">
      {/* Header */}
      <header class="hypatia-screen-header">
        <div class="hypatia-screen-header__left">
          <IconButton label="Back" onClick={navigateBack}>
            <BackIcon />
          </IconButton>
          <div>
            <h1 class="hypatia-screen-title">
              {campaign.representative_subject || 'Untitled Campaign'}
            </h1>
            <span class="hypatia-text-secondary hypatia-text-sm">
              {campaign.unique_recipients?.length || 0} recipients analyzed
            </span>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div class="hypatia-stats-grid">
        <StatCard
          label="Historical Emails"
          value={campaign.email_count || 0}
          icon={<EmailIcon />}
        />
        <StatCard
          label="Leads Generated"
          value={campaign.leads_count || 0}
          icon={<LeadsIcon />}
          variant={hasLeads ? 'success' : 'default'}
        />
        <StatCard
          label="Emails Sent"
          value={campaign.sent_count || 0}
          icon={<SentIcon />}
        />
        <StatCard
          label="Similarity"
          value={`${Math.round((campaign.similarity_score || 0) * 100)}%`}
          icon={<ChartIcon />}
        />
      </div>

      {/* Campaign Analysis Section */}
      {campaign.analysis && (
        <section class="hypatia-detail-section">
          <h2 class="hypatia-section-title">Campaign Analysis</h2>
          <div class="hypatia-analysis-grid">
            <AnalysisCard
              title="Writing Style"
              content={campaign.analysis.style || 'Not analyzed'}
              icon={<StyleIcon />}
            />
            <AnalysisCard
              title="Call-to-Action"
              content={campaign.analysis.cta_type || 'Not analyzed'}
              icon={<CTAIcon />}
            />
            <AnalysisCard
              title="Target Contacts"
              content={campaign.analysis.target_contacts || 'Not analyzed'}
              icon={<TargetIcon />}
            />
          </div>
        </section>
      )}

      {/* Action Cards */}
      <section class="hypatia-detail-section">
        <h2 class="hypatia-section-title">Actions</h2>
        <div class="hypatia-actions-grid">
          {/* Generate Leads Card */}
          <ActionCard
            title="Generate Leads"
            description="Find people matching your campaign's target audience"
            icon={<LeadsIcon />}
            status={hasLeads ? 'done' : 'pending'}
            statusText={hasLeads ? `${campaign.leads_count} leads` : 'Not started'}
            onClick={() => navigate(ROUTES.LEADS)}
          />

          {/* Email Template Card */}
          <ActionCard
            title="Email Template"
            description="Create or edit your personalized email template"
            icon={<TemplateIcon />}
            status={hasTemplate ? 'done' : 'pending'}
            statusText={hasTemplate ? 'Template ready' : 'Not created'}
            onClick={() => navigate(ROUTES.TEMPLATES)}
          />

          {/* Send Emails Card */}
          <ActionCard
            title="Send Emails"
            description="Send personalized emails to your leads"
            icon={<SentIcon />}
            status={canSend ? 'ready' : 'disabled'}
            statusText={canSend ? 'Ready to send' : 'Complete leads & template first'}
            onClick={canSend ? () => navigate(ROUTES.SENT) : undefined}
            disabled={!canSend}
          />

          {/* Track Sent Card */}
          <ActionCard
            title="Track Sent Emails"
            description="View delivery status and responses"
            icon={<TrackIcon />}
            statusText={`${campaign.sent_count || 0} emails tracked`}
            onClick={() => navigate(ROUTES.SENT)}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * Stat card component
 */
function StatCard({ label, value, icon, variant = 'default' }) {
  return (
    <div class={`hypatia-stat-card hypatia-stat-card--${variant}`}>
      <div class="hypatia-stat-card__icon">{icon}</div>
      <div class="hypatia-stat-card__content">
        <span class="hypatia-stat-card__value">{value}</span>
        <span class="hypatia-stat-card__label">{label}</span>
      </div>
    </div>
  );
}

/**
 * Analysis card component
 */
function AnalysisCard({ title, content, icon }) {
  return (
    <Card>
      <CardBody>
        <div class="hypatia-flex hypatia-items-center hypatia-gap-3">
          <div class="hypatia-analysis-card__icon">{icon}</div>
          <div>
            <h4 class="hypatia-text-sm hypatia-font-medium">{title}</h4>
            <p class="hypatia-text-secondary hypatia-text-sm hypatia-line-clamp-2">
              {content}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Action card component
 */
function ActionCard({ title, description, icon, status, statusText, onClick, disabled }) {
  const statusVariant = {
    done: 'success',
    pending: 'warning',
    ready: 'primary',
    disabled: 'default'
  }[status] || 'default';

  return (
    <Card interactive={!disabled} onClick={onClick}>
      <CardBody>
        <div class="hypatia-action-card">
          <div class="hypatia-action-card__icon">{icon}</div>
          <div class="hypatia-action-card__content">
            <h3 class="hypatia-action-card__title">{title}</h3>
            <p class="hypatia-text-secondary hypatia-text-sm">{description}</p>
          </div>
          {statusText && (
            <Badge variant={statusVariant}>{statusText}</Badge>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// Icons
function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}

function LeadsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SentIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function StyleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function CTAIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function TrackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
