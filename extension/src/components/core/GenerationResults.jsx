import { chatGenerationResults, actions } from '../../context/AppContext';

/**
 * Generation Results Panel
 * Displays AI-generated leads and templates at the top of the sidebar
 * after user submits a chat message with detected intents
 */
export function GenerationResults() {
  const state = chatGenerationResults.value;

  // Don't render if not visible
  if (!state.isVisible) {
    return null;
  }

  const hasLeads = state.leadsResult?.leads?.length > 0;
  const hasTemplate = state.templateResult;
  const isLoading = state.leadsLoading || state.templateLoading;

  return (
    <div class="hypatia-generation-results">
      {/* Header */}
      <div class="hypatia-generation-results__header">
        <div class="hypatia-generation-results__title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span>Generation Results</span>
          {isLoading && <Spinner />}
        </div>
        <div class="hypatia-generation-results__actions">
          <button
            class="hypatia-generation-results__toggle"
            onClick={actions.toggleChatResultsExpanded}
            title={state.isExpanded ? 'Collapse' : 'Expand'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              {state.isExpanded ? (
                <path d="M18 15l-6-6-6 6" />
              ) : (
                <path d="M6 9l6 6 6-6" />
              )}
            </svg>
          </button>
          <button
            class="hypatia-generation-results__close"
            onClick={actions.hideChatGenerationResults}
            title="Dismiss"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div class={`hypatia-generation-results__content ${state.isExpanded ? 'expanded' : ''}`}>
        {/* Leads Section */}
        {(state.leadsLoading || hasLeads || state.leadsError) && (
          <LeadsSection
            loading={state.leadsLoading}
            leads={state.leadsResult?.leads || []}
            count={state.leadsResult?.count || state.leadsResult?.leads?.length || 0}
            error={state.leadsError}
            expanded={state.isExpanded}
          />
        )}

        {/* Template Section */}
        {(state.templateLoading || hasTemplate || state.templateError) && (
          <TemplateSection
            loading={state.templateLoading}
            template={state.templateResult}
            error={state.templateError}
            expanded={state.isExpanded}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Small loading spinner
 */
function Spinner() {
  return (
    <svg class="hypatia-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

/**
 * Leads summary/list section
 */
function LeadsSection({ loading, leads, count, error, expanded }) {
  const displayLeads = expanded ? leads : leads.slice(0, 3);

  return (
    <div class="hypatia-generation-section hypatia-generation-section--leads">
      <div class="hypatia-generation-section__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>Contacts</span>
        {!loading && count > 0 && <span class="hypatia-badge">{count}</span>}
      </div>

      <div class="hypatia-generation-section__body">
        {loading ? (
          <div class="hypatia-generation-loading">
            <Spinner />
            <span>Finding contacts...</span>
          </div>
        ) : error ? (
          <div class="hypatia-generation-error">
            <span>Failed to find contacts</span>
          </div>
        ) : leads.length === 0 ? (
          <div class="hypatia-generation-empty">
            <span>No contacts found</span>
          </div>
        ) : (
          <>
            {displayLeads.map((lead, index) => (
              <LeadCard key={lead.email || index} lead={lead} compact={!expanded} />
            ))}
            {!expanded && leads.length > 3 && (
              <button class="hypatia-generation-view-more" onClick={actions.toggleChatResultsExpanded}>
                +{leads.length - 3} more contacts
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Compact lead card
 */
function LeadCard({ lead, compact }) {
  const name = lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
  const initial = name.charAt(0).toUpperCase();
  const subtitle = [lead.title, lead.company].filter(Boolean).join(' at ');

  return (
    <div class={`hypatia-lead-card ${compact ? 'hypatia-lead-card--compact' : ''}`}>
      <div class="hypatia-lead-card__avatar">
        {initial}
      </div>
      <div class="hypatia-lead-card__info">
        <div class="hypatia-lead-card__name">{name}</div>
        {compact ? (
          <div class="hypatia-lead-card__subtitle">{subtitle || 'No details'}</div>
        ) : (
          <>
            {lead.title && <div class="hypatia-lead-card__title">{lead.title}</div>}
            {lead.company && <div class="hypatia-lead-card__company">{lead.company}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Template preview section
 */
function TemplateSection({ loading, template, error, expanded }) {
  const truncateBody = (body, maxLength = 120) => {
    if (!body) return '';
    if (body.length <= maxLength) return body;
    return body.substring(0, maxLength).trim() + '...';
  };

  return (
    <div class="hypatia-generation-section hypatia-generation-section--template">
      <div class="hypatia-generation-section__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span>Template</span>
      </div>

      <div class="hypatia-generation-section__body">
        {loading ? (
          <div class="hypatia-generation-loading">
            <Spinner />
            <span>Generating template...</span>
          </div>
        ) : error ? (
          <div class="hypatia-generation-error">
            <span>Failed to generate template</span>
          </div>
        ) : !template ? (
          <div class="hypatia-generation-empty">
            <span>No template generated</span>
          </div>
        ) : (
          <div class="hypatia-template-preview">
            <div class="hypatia-template-preview__subject">
              <strong>Subject:</strong> {template.subject}
            </div>
            <div class="hypatia-template-preview__body">
              {expanded ? template.body : truncateBody(template.body)}
            </div>
            {template.placeholders?.length > 0 && (
              <div class="hypatia-template-preview__placeholders">
                {template.placeholders.map(p => (
                  <span key={p} class="hypatia-badge hypatia-badge--placeholder">{`{${p}}`}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
