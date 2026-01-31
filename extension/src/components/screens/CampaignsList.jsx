import { useEffect, useState } from 'preact/hooks';
import { campaigns, campaignsPage, campaignsPerPage, actions, api } from '../../context/AppContext';
import { navigate, ROUTES } from '../../hooks/useNavigation';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Avatar, AvatarGroup } from '../ui/Avatar';
import { SearchInput } from '../ui/Input';
import { LoadingScreen } from '../ui/Spinner';
import { EmptyState, EmptyIcons } from '../ui/EmptyState';

/**
 * Campaigns list screen - shows all user campaigns in a responsive grid
 */
export function CampaignsList() {
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Load campaigns on mount
  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    try {
      setIsLoading(true);
      const data = await api.fetchCampaigns();
      actions.setCampaigns(data);
    } catch (err) {
      console.error('[Hypatia] Failed to load campaigns:', err?.message || err);
    } finally {
      setIsLoading(false);
    }
  }

  // Filter campaigns by search
  const filteredCampaigns = campaigns.value.filter(campaign => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      campaign.name?.toLowerCase().includes(query) ||
      campaign.representative_subject?.toLowerCase().includes(query)
    );
  });

  // Paginate
  const page = campaignsPage.value;
  const perPage = campaignsPerPage.value;
  const totalPages = Math.ceil(filteredCampaigns.length / perPage);
  const paginatedCampaigns = filteredCampaigns.slice(
    (page - 1) * perPage,
    page * perPage
  );

  if (isLoading) {
    return <LoadingScreen message="Loading campaigns..." />;
  }

  return (
    <div class="hypatia-campaigns-screen">
      {/* Header */}
      <header class="hypatia-screen-header">
        <div class="hypatia-screen-header__left">
          <h1 class="hypatia-screen-title">Campaigns</h1>
          <span class="hypatia-text-secondary hypatia-text-sm">
            {campaigns.value.length} campaign{campaigns.value.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div class="hypatia-screen-header__right">
          <SearchInput
            placeholder="Search campaigns..."
            value={searchQuery}
            onSearch={setSearchQuery}
          />
        </div>
      </header>

      {/* Content */}
      {campaigns.value.length === 0 ? (
        <EmptyState
          icon={EmptyIcons.campaigns}
          title="No campaigns yet"
          description="Campaigns are automatically created when we analyze your sent emails and detect outreach patterns."
          actionText="Refresh"
          onAction={loadCampaigns}
        />
      ) : filteredCampaigns.length === 0 ? (
        <EmptyState
          icon={EmptyIcons.search}
          title="No matches found"
          description={`No campaigns match "${searchQuery}"`}
          actionText="Clear search"
          onAction={() => setSearchQuery('')}
        />
      ) : (
        <>
          {/* Campaign Grid */}
          <div class="hypatia-campaigns-grid">
            {paginatedCampaigns.map(campaign => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                onClick={() => {
                  actions.selectCampaign(campaign.id);
                  navigate(ROUTES.CAMPAIGN, { campaignId: campaign.id });
                }}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div class="hypatia-pagination">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 1}
                onClick={() => campaignsPage.value = page - 1}
              >
                Previous
              </Button>
              <span class="hypatia-text-secondary hypatia-text-sm">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page === totalPages}
                onClick={() => campaignsPage.value = page + 1}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Individual campaign card
 */
function CampaignCard({ campaign, onClick }) {
  const recipientCount = campaign.unique_recipients?.length || 0;
  const emailCount = campaign.email_count || 0;
  const hasLeads = (campaign.leads_count || 0) > 0;
  const hasTemplate = !!campaign.template_id;

  // Get sample recipients for avatar group
  const recipients = (campaign.unique_recipients || []).slice(0, 3).map(email => ({
    name: email.split('@')[0]
  }));

  return (
    <Card interactive onClick={onClick}>
      <CardBody>
        {/* Campaign Status */}
        <div class="hypatia-campaign-card__status">
          {hasLeads && hasTemplate ? (
            <Badge variant="success">Ready</Badge>
          ) : hasLeads || hasTemplate ? (
            <Badge variant="warning">In Progress</Badge>
          ) : (
            <Badge variant="default">New</Badge>
          )}
        </div>

        {/* Subject Line */}
        <h3 class="hypatia-campaign-card__title">
          {campaign.representative_subject || 'Untitled Campaign'}
        </h3>

        {/* Recipients */}
        <div class="hypatia-campaign-card__meta">
          {recipients.length > 0 && (
            <AvatarGroup avatars={recipients} max={3} size="sm" />
          )}
          <span class="hypatia-text-secondary hypatia-text-sm">
            {recipientCount} recipient{recipientCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Stats Row */}
        <div class="hypatia-campaign-card__stats">
          <div class="hypatia-campaign-card__stat">
            <span class="hypatia-text-tertiary hypatia-text-xs">Emails</span>
            <span class="hypatia-font-medium">{emailCount}</span>
          </div>
          <div class="hypatia-campaign-card__stat">
            <span class="hypatia-text-tertiary hypatia-text-xs">Leads</span>
            <span class="hypatia-font-medium">{campaign.leads_count || 0}</span>
          </div>
          <div class="hypatia-campaign-card__stat">
            <span class="hypatia-text-tertiary hypatia-text-xs">Sent</span>
            <span class="hypatia-font-medium">{campaign.sent_count || 0}</span>
          </div>
        </div>

        {/* Quick Actions (on hover) */}
        <div class="hypatia-campaign-card__actions">
          <Button variant="secondary" size="sm">
            View Details
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
