import { useEffect, useState } from 'preact/hooks';
import {
  selectedCampaign,
  currentTemplate,
  currentLeads,
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

const TEMPLATE_VARIABLES = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title' },
  { key: 'email', label: 'Email' }
];

/**
 * Template editor screen - edit and preview email templates
 */
export function TemplateEditor() {
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const campaign = selectedCampaign.value;
  const template = currentTemplate.value;
  const leads = currentLeads.value;

  // Load template if exists
  useEffect(() => {
    if (campaign?.template) {
      actions.setTemplate(campaign.template);
    }
  }, [campaign?.template]);

  async function handleGenerateTemplate() {
    try {
      setIsGenerating(true);
      const result = await api.generateTemplate(campaign.id);
      if (result.template) {
        actions.setTemplate(result.template);
      }
    } catch (err) {
      console.error('[Hypatia] Failed to generate template:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave() {
    try {
      setIsSaving(true);
      await api.saveTemplate(campaign.id, template);
      navigateBack();
    } catch (err) {
      console.error('[Hypatia] Failed to save template:', err);
    } finally {
      setIsSaving(false);
    }
  }

  function insertVariable(variable) {
    const textarea = document.getElementById('template-body');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = template.body;
    const insertion = `{{${variable}}}`;

    const newBody = text.substring(0, start) + insertion + text.substring(end);
    actions.updateTemplate({ body: newBody });

    // Reset cursor position after render
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }

  function getPreviewLead() {
    if (leads.length === 0) {
      return {
        first_name: 'John',
        last_name: 'Doe',
        company: 'Example Inc',
        title: 'CEO',
        email: 'john@example.com'
      };
    }
    return leads[previewIndex % leads.length];
  }

  function renderPreview(text, lead) {
    if (!text) return '';
    return text
      .replace(/\{\{first_name\}\}/g, lead.first_name || '')
      .replace(/\{\{last_name\}\}/g, lead.last_name || '')
      .replace(/\{\{company\}\}/g, lead.company || '')
      .replace(/\{\{title\}\}/g, lead.title || '')
      .replace(/\{\{email\}\}/g, lead.email || '');
  }

  const previewLead = getPreviewLead();

  if (!campaign) {
    return <LoadingScreen message="Loading..." />;
  }

  return (
    <div class="hypatia-template-screen">
      {/* Header */}
      <header class="hypatia-screen-header">
        <div class="hypatia-screen-header__left">
          <IconButton label="Back" onClick={navigateBack}>
            <BackIcon />
          </IconButton>
          <div>
            <Badge variant="primary">Template</Badge>
            <h1 class="hypatia-screen-title">Email Template</h1>
          </div>
        </div>
        <div class="hypatia-screen-header__right">
          <Button
            variant="secondary"
            onClick={handleGenerateTemplate}
            loading={isGenerating}
          >
            Regenerate with AI
          </Button>
        </div>
      </header>

      {/* Two Column Layout */}
      <div class="hypatia-template-layout">
        {/* Left: Editor */}
        <div class="hypatia-template-editor">
          <Card>
            <CardBody>
              {/* Subject Line */}
              <div class="hypatia-template-field">
                <label class="hypatia-input-label">Subject Line</label>
                <Input
                  value={template.subject}
                  onInput={(e) => actions.updateTemplate({ subject: e.target.value })}
                  placeholder="Enter email subject..."
                />
              </div>

              {/* Email Body */}
              <div class="hypatia-template-field">
                <label class="hypatia-input-label">Email Body</label>
                <Textarea
                  id="template-body"
                  value={template.body}
                  onInput={(e) => actions.updateTemplate({ body: e.target.value })}
                  placeholder="Write your email template..."
                  rows={12}
                />
              </div>

              {/* Variable Chips */}
              <div class="hypatia-template-variables">
                <span class="hypatia-text-sm hypatia-text-secondary">Insert variable:</span>
                <div class="hypatia-variable-chips">
                  {TEMPLATE_VARIABLES.map(v => (
                    <button
                      key={v.key}
                      class="hypatia-variable-chip"
                      onClick={() => insertVariable(v.key)}
                    >
                      {`{{${v.label}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Style Info */}
              {campaign.analysis?.style && (
                <div class="hypatia-template-style-info">
                  <span class="hypatia-text-sm hypatia-font-medium">Writing Style:</span>
                  <span class="hypatia-text-sm hypatia-text-secondary">
                    {campaign.analysis.style}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right: Preview */}
        <div class="hypatia-template-preview">
          <Card>
            <CardBody>
              <div class="hypatia-preview-header">
                <h3 class="hypatia-text-base hypatia-font-medium">Live Preview</h3>
                {leads.length > 1 && (
                  <div class="hypatia-preview-nav">
                    <IconButton
                      label="Previous"
                      size="sm"
                      onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                      disabled={previewIndex === 0}
                    >
                      <ChevronLeftIcon />
                    </IconButton>
                    <span class="hypatia-text-sm hypatia-text-secondary">
                      {previewIndex + 1} / {leads.length}
                    </span>
                    <IconButton
                      label="Next"
                      size="sm"
                      onClick={() => setPreviewIndex(i => Math.min(leads.length - 1, i + 1))}
                      disabled={previewIndex >= leads.length - 1}
                    >
                      <ChevronRightIcon />
                    </IconButton>
                  </div>
                )}
              </div>

              {/* Preview Lead Info */}
              <div class="hypatia-preview-lead">
                <Avatar name={`${previewLead.first_name} ${previewLead.last_name}`} size="sm" />
                <div>
                  <div class="hypatia-text-sm hypatia-font-medium">
                    {previewLead.first_name} {previewLead.last_name}
                  </div>
                  <div class="hypatia-text-xs hypatia-text-secondary">
                    {[previewLead.title, previewLead.company].filter(Boolean).join(' at ')}
                  </div>
                </div>
              </div>

              {/* Email Preview */}
              <div class="hypatia-email-preview">
                <div class="hypatia-email-preview__header">
                  <div class="hypatia-email-preview__to">
                    <span class="hypatia-text-tertiary">To:</span>
                    <span>{previewLead.email}</span>
                  </div>
                  <div class="hypatia-email-preview__subject">
                    <span class="hypatia-text-tertiary">Subject:</span>
                    <span class="hypatia-font-medium">
                      {renderPreview(template.subject, previewLead) || 'No subject'}
                    </span>
                  </div>
                </div>
                <div class="hypatia-email-preview__body">
                  {renderPreview(template.body, previewLead) || 'No content'}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div class="hypatia-template-footer">
        <Button variant="secondary" onClick={navigateBack}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} loading={isSaving}>
          Save & Continue
        </Button>
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

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
