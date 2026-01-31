import { useEffect, useState } from 'preact/hooks';
import {
  selectedCampaign,
  currentLeads,
  selectedLeadIds,
  actions,
  api
} from '../../context/AppContext';
import { navigateBack } from '../../hooks/useNavigation';
import { Card, CardBody } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { LoadingScreen, Spinner } from '../ui/Spinner';
import { EmptyState, EmptyIcons } from '../ui/EmptyState';

/**
 * Leads screen - search, generate, and manage leads
 */
export function LeadsScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [leadLimit, setLeadLimit] = useState(10);
  const [manualLead, setManualLead] = useState({ firstName: '', lastName: '', email: '' });

  const campaign = selectedCampaign.value;
  const leads = currentLeads.value;
  const selected = selectedLeadIds.value;

  // Load leads on mount
  useEffect(() => {
    if (campaign?.id) {
      loadLeads();
    }
  }, [campaign?.id]);

  async function loadLeads() {
    try {
      setIsLoading(true);
      const data = await api.fetchCampaignLeads(campaign.id);
      actions.setLeads(data);
    } catch (err) {
      console.error('[Hypatia] Failed to load leads:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerateLeads() {
    if (!searchQuery.trim()) return;

    try {
      setIsGenerating(true);
      const result = await api.generateLeads(campaign.id, searchQuery, leadLimit);
      if (result.leads) {
        actions.setLeads([...leads, ...result.leads]);
      }
      setSearchQuery('');
    } catch (err) {
      console.error('[Hypatia] Failed to generate leads:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAddManualLead() {
    if (!manualLead.email.trim()) return;

    try {
      const lead = {
        first_name: manualLead.firstName,
        last_name: manualLead.lastName,
        email: manualLead.email,
        source: 'manual'
      };
      await api.saveLead(campaign.id, lead);
      actions.addLead({ ...lead, id: Date.now().toString() });
      setManualLead({ firstName: '', lastName: '', email: '' });
    } catch (err) {
      console.error('[Hypatia] Failed to add lead:', err);
    }
  }

  const suggestions = [
    'Startup founders in San Francisco',
    'Marketing managers at tech companies',
    'Product managers in fintech',
    'Sales directors at SaaS companies'
  ];

  if (!campaign) {
    return <LoadingScreen message="Loading..." />;
  }

  return (
    <div class="hypatia-leads-screen">
      {/* Header */}
      <header class="hypatia-screen-header">
        <div class="hypatia-screen-header__left">
          <IconButton label="Back" onClick={navigateBack}>
            <BackIcon />
          </IconButton>
          <div>
            <Badge variant="primary">Leads</Badge>
            <h1 class="hypatia-screen-title">Find Leads</h1>
          </div>
        </div>
        <div class="hypatia-screen-header__right">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {/* Export CSV */}}
          >
            Export CSV
          </Button>
        </div>
      </header>

      {/* Main Content - Single Column Flow */}
      <div class="hypatia-leads-content">
        {/* AI Lead Search Section */}
        <section class="hypatia-leads-section">
          <h2 class="hypatia-section-title">Find Leads with AI</h2>
          <Card>
            <CardBody>
              <Textarea
                placeholder="Describe who you want to contact (e.g., 'Startup founders in healthcare who have raised Series A')"
                value={searchQuery}
                onInput={(e) => setSearchQuery(e.target.value)}
                rows={3}
              />

              {/* Quick Suggestions */}
              <div class="hypatia-leads-suggestions">
                {suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    class="hypatia-suggestion-chip"
                    onClick={() => setSearchQuery(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              {/* Limit and Generate */}
              <div class="hypatia-leads-generate-row">
                <div class="hypatia-leads-limit">
                  <span class="hypatia-text-sm hypatia-text-secondary">Find up to</span>
                  <select
                    class="hypatia-select"
                    value={leadLimit}
                    onChange={(e) => setLeadLimit(Number(e.target.value))}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                  </select>
                  <span class="hypatia-text-sm hypatia-text-secondary">leads</span>
                </div>
                <Button
                  variant="primary"
                  onClick={handleGenerateLeads}
                  loading={isGenerating}
                  disabled={!searchQuery.trim()}
                >
                  Generate Leads
                </Button>
              </div>
            </CardBody>
          </Card>
        </section>

        {/* Manual Add Section */}
        <section class="hypatia-leads-section">
          <h2 class="hypatia-section-title">Add Manually</h2>
          <Card>
            <CardBody>
              <div class="hypatia-manual-lead-form">
                <Input
                  placeholder="First name"
                  value={manualLead.firstName}
                  onInput={(e) => setManualLead({ ...manualLead, firstName: e.target.value })}
                />
                <Input
                  placeholder="Last name"
                  value={manualLead.lastName}
                  onInput={(e) => setManualLead({ ...manualLead, lastName: e.target.value })}
                />
                <Input
                  placeholder="Email"
                  type="email"
                  value={manualLead.email}
                  onInput={(e) => setManualLead({ ...manualLead, email: e.target.value })}
                />
                <Button
                  variant="secondary"
                  onClick={handleAddManualLead}
                  disabled={!manualLead.email.trim()}
                >
                  Add
                </Button>
              </div>
            </CardBody>
          </Card>
        </section>

        {/* Leads List Section */}
        <section class="hypatia-leads-section">
          <div class="hypatia-section-header">
            <h2 class="hypatia-section-title">
              Leads
              <span class="hypatia-text-secondary hypatia-text-sm hypatia-font-normal">
                {' '}({leads.length})
              </span>
            </h2>
            {leads.length > 0 && (
              <div class="hypatia-flex hypatia-gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.selectAllLeads()}
                >
                  Select all
                </Button>
                {selected.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => actions.deselectAllLeads()}
                  >
                    Deselect ({selected.size})
                  </Button>
                )}
              </div>
            )}
          </div>

          {isLoading ? (
            <LoadingScreen message="Loading leads..." />
          ) : leads.length === 0 ? (
            <EmptyState
              icon={EmptyIcons.leads}
              title="No leads yet"
              description="Use the AI search above to find leads matching your target audience"
            />
          ) : (
            <div class="hypatia-leads-list">
              {leads.map(lead => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  isSelected={selected.has(lead.id)}
                  onToggle={() => actions.toggleLeadSelection(lead.id)}
                  onRemove={() => actions.removeLead(lead.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Footer Actions */}
        {leads.length > 0 && (
          <div class="hypatia-leads-footer">
            <span class="hypatia-text-secondary">
              {selected.size > 0 ? `${selected.size} selected` : `${leads.length} leads`}
            </span>
            <Button variant="primary" onClick={navigateBack}>
              Save & Continue
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Lead row component
 */
function LeadRow({ lead, isSelected, onToggle, onRemove }) {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
  const meta = [lead.title, lead.company].filter(Boolean).join(' at ');

  return (
    <div class={`hypatia-lead-row ${isSelected ? 'hypatia-lead-row--selected' : ''}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        class="hypatia-checkbox"
      />
      <Avatar name={fullName} size="sm" />
      <div class="hypatia-lead-row__content">
        <div class="hypatia-lead-row__name">{fullName}</div>
        {meta && <div class="hypatia-text-secondary hypatia-text-sm">{meta}</div>}
        <div class="hypatia-text-tertiary hypatia-text-xs">{lead.email}</div>
      </div>
      <div class="hypatia-lead-row__actions">
        {lead.linkedin_url && (
          <a
            href={lead.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            class="hypatia-link-icon"
            title="View LinkedIn"
          >
            <LinkedInIcon />
          </a>
        )}
        <Badge variant={lead.source === 'manual' ? 'default' : 'primary'}>
          {lead.source === 'manual' ? 'Manual' : 'AI'}
        </Badge>
        <IconButton label="Remove" size="sm" onClick={onRemove}>
          <RemoveIcon />
        </IconButton>
      </div>
    </div>
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

function LinkedInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
