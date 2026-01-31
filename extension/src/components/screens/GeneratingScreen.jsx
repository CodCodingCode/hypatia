import { generationState, actions } from '../../context/AppContext';
import { navigateBack } from '../../hooks/useNavigation';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';

/**
 * Generating screen - shows parallel progress for leads, template, and cadence
 */
export function GeneratingScreen() {
  const state = generationState.value;

  function handleCancel() {
    actions.resetGeneration();
    navigateBack();
  }

  function handleRetry(type) {
    // Clear error and restart generation for this type
    actions.startGeneration(type);
    // Trigger the actual generation (would need to be implemented)
  }

  return (
    <div class="hypatia-generating-screen">
      {/* Header */}
      <header class="hypatia-generating-header">
        <h1 class="hypatia-screen-title">Generating Campaign Assets</h1>
        <p class="hypatia-text-secondary">
          We're finding leads and creating personalized content for your campaign
        </p>
      </header>

      {/* Progress Sections */}
      <div class="hypatia-generating-grid">
        {/* Leads Section */}
        <GeneratingSection
          title="Finding Leads"
          description="Searching for contacts matching your criteria"
          isLoading={state.leadsLoading}
          result={state.leadsResult}
          error={state.leadsError}
          onRetry={() => handleRetry('leads')}
          renderResult={(result) => (
            <div class="hypatia-generating-leads">
              <div class="hypatia-generating-leads__header">
                <Badge variant="success">Found {result.length} leads</Badge>
              </div>
              <div class="hypatia-generating-leads__list">
                {result.slice(0, 5).map((lead, i) => (
                  <div key={i} class="hypatia-generating-lead-item">
                    <Avatar
                      name={`${lead.first_name} ${lead.last_name}`}
                      size="sm"
                    />
                    <div>
                      <div class="hypatia-text-sm hypatia-font-medium">
                        {lead.first_name} {lead.last_name}
                      </div>
                      <div class="hypatia-text-xs hypatia-text-secondary">
                        {[lead.title, lead.company].filter(Boolean).join(' at ')}
                      </div>
                    </div>
                    {lead.linkedin_url && (
                      <a
                        href={lead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hypatia-text-xs hypatia-link"
                      >
                        LinkedIn
                      </a>
                    )}
                  </div>
                ))}
                {result.length > 5 && (
                  <div class="hypatia-text-sm hypatia-text-secondary">
                    +{result.length - 5} more leads
                  </div>
                )}
              </div>
            </div>
          )}
        />

        {/* Template Section */}
        <GeneratingSection
          title="Creating Template"
          description="Generating personalized email template"
          isLoading={state.templateLoading}
          result={state.templateResult}
          error={state.templateError}
          onRetry={() => handleRetry('template')}
          renderResult={(result) => (
            <div class="hypatia-generating-template">
              <div class="hypatia-generating-template__subject">
                <span class="hypatia-text-tertiary">Subject:</span>
                <span class="hypatia-font-medium">{result.subject}</span>
              </div>
              <div class="hypatia-generating-template__body">
                {result.body.substring(0, 200)}
                {result.body.length > 200 && '...'}
              </div>
              <div class="hypatia-generating-template__variables">
                {['first_name', 'company'].map(v => (
                  <span key={v} class="hypatia-variable-chip hypatia-variable-chip--small">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        />

        {/* Cadence Section */}
        <GeneratingSection
          title="Building Sequence"
          description="Creating follow-up email cadence"
          isLoading={state.cadenceLoading}
          result={state.cadenceResult}
          error={state.cadenceError}
          onRetry={() => handleRetry('cadence')}
          renderResult={(result) => (
            <div class="hypatia-generating-cadence">
              {result.emails?.map((email, i) => (
                <div key={i} class="hypatia-cadence-step">
                  <div class="hypatia-cadence-step__day">
                    <Badge variant={i === 0 ? 'primary' : 'default'}>
                      Day {email.day}
                    </Badge>
                  </div>
                  <div class="hypatia-cadence-step__content">
                    <div class="hypatia-text-sm hypatia-font-medium">
                      {email.subject || `Follow-up ${i + 1}`}
                    </div>
                    <div class="hypatia-text-xs hypatia-text-secondary">
                      {email.type || 'Follow-up email'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        />
      </div>

      {/* Footer */}
      <div class="hypatia-generating-footer">
        {state.isGenerating ? (
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={navigateBack}>
            Continue to Campaign
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Individual generating section component
 */
function GeneratingSection({
  title,
  description,
  isLoading,
  result,
  error,
  onRetry,
  renderResult
}) {
  return (
    <Card>
      <CardBody>
        <div class="hypatia-generating-section">
          {/* Header */}
          <div class="hypatia-generating-section__header">
            <h3 class="hypatia-text-base hypatia-font-medium">{title}</h3>
            {isLoading && (
              <Badge variant="primary">
                <Spinner size="sm" /> In Progress
              </Badge>
            )}
            {result && !isLoading && (
              <Badge variant="success">Complete</Badge>
            )}
            {error && !isLoading && (
              <Badge variant="error">Failed</Badge>
            )}
          </div>

          {/* Content */}
          <div class="hypatia-generating-section__content">
            {isLoading && (
              <div class="hypatia-generating-loading">
                <Spinner size="lg" />
                <p class="hypatia-text-secondary hypatia-text-sm">{description}</p>
              </div>
            )}

            {result && !isLoading && renderResult(result)}

            {error && !isLoading && (
              <div class="hypatia-generating-error">
                <div class="hypatia-generating-error__icon">!</div>
                <p class="hypatia-text-error hypatia-text-sm">{error}</p>
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
