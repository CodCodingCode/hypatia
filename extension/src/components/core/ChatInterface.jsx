import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { chatMessages, chatInput, actions, api } from '../../context/AppContext';
import { Spinner } from '../ui/Spinner';

const SUGGESTED_PROMPTS = [
  'What are my most important emails this week?',
  'Help me draft a reply to the latest email',
  'Summarize my unread emails'
];

const INTENT_CHIPS = [
  { key: 'who_to_contact', label: 'who to contact' },
  { key: 'ask', label: 'ask' },
  { key: 'template', label: 'template' }
];

/**
 * Chat interface component with message history and input
 */
export function ChatInterface() {
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Intent detection state
  const [intentAnalysis, setIntentAnalysis] = useState({
    who_to_contact: false,
    ask: false,
    template: false
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages.value]);

  // Debounced intent analysis
  const analyzeIntent = useCallback((text) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'analyzeChatIntent',
          text: text
        });
        if (response && response.success) {
          setIntentAnalysis(response.categories);
        }
      } catch (error) {
        console.warn('[Hypatia] Intent analysis error:', error);
      }
    }, 500);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const input = chatInput.value.trim();
    if (!input) return;

    // Capture current intent state before resetting
    const capturedIntents = { ...intentAnalysis };
    const shouldGenerateLeads = capturedIntents.who_to_contact;
    const shouldGenerateTemplate = capturedIntents.template || capturedIntents.ask;

    // Add user message
    actions.addChatMessage({
      id: Date.now(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    });

    // Clear input and reset intent analysis
    actions.setChatInput('');
    setIntentAnalysis({ who_to_contact: false, ask: false, template: false });

    // Check if we should trigger generation
    if (shouldGenerateLeads || shouldGenerateTemplate) {
      // Show the generation results panel with loading states
      actions.showChatGenerationResults(input, {
        generateLeads: shouldGenerateLeads,
        generateTemplate: shouldGenerateTemplate,
      });

      // Fire API calls based on detected intents
      if (shouldGenerateLeads) {
        api.generateLeads(null, input, 20)
          .then(result => {
            if (result && result.success !== false) {
              actions.setChatLeadsResult(result);
            } else {
              actions.setChatLeadsResult(null, result?.error || 'Failed to generate leads');
            }
          })
          .catch(err => actions.setChatLeadsResult(null, err.message));
      }

      if (shouldGenerateTemplate) {
        // Get or create Quick Generation campaign, then generate template
        api.getOrCreateQuickCampaign()
          .then(campaign => {
            if (campaign && campaign.id) {
              actions.setChatGenerationCampaignId(campaign.id);
              // Extract CTA from user input for template generation
              return api.generateTemplateWithCta(campaign.id, input, '');
            }
            throw new Error('Could not create campaign');
          })
          .then(result => {
            if (result && result.success !== false && result.template) {
              actions.setChatTemplateResult(result.template);
            } else {
              actions.setChatTemplateResult(null, result?.error || 'Failed to generate template');
            }
          })
          .catch(err => actions.setChatTemplateResult(null, err.message));
      }

      // Add assistant acknowledgment
      actions.addChatMessage({
        id: Date.now(),
        role: 'assistant',
        content: `Processing your request${shouldGenerateLeads ? ' to find contacts' : ''}${shouldGenerateLeads && shouldGenerateTemplate ? ' and' : ''}${shouldGenerateTemplate ? ' to generate a template' : ''}. See results above.`,
        timestamp: new Date().toISOString()
      });
    } else {
      // No generation needed - just respond normally
      actions.addChatMessage({
        id: Date.now(),
        role: 'assistant',
        content: `I received your message: "${input}". Try asking me to find contacts or create a template for your outreach.`,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handlePromptClick = (prompt) => {
    actions.setChatInput(prompt);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    actions.setChatInput(value);
    analyzeIntent(value);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div class="hypatia-chat">
      <div class="hypatia-chat__messages">
        {chatMessages.value.length === 0 ? (
          <EmptyChat onPromptClick={handlePromptClick} />
        ) : (
          <>
            {chatMessages.value.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <form class="hypatia-chat__input-container" onSubmit={handleSubmit}>
        <div class="hypatia-intent-chips">
          {INTENT_CHIPS.map((chip) => (
            <span
              key={chip.key}
              class={`hypatia-intent-chip ${intentAnalysis[chip.key] ? 'active' : ''}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
        <div class="hypatia-chat__input-wrapper">
          <textarea
            ref={inputRef}
            class="hypatia-chat__input"
            value={chatInput.value}
            onInput={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="type @ for context, / for actions..."
            rows="1"
          />
          <button
            type="submit"
            class="hypatia-chat__send-button"
            disabled={!chatInput.value.trim()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function EmptyChat({ onPromptClick }) {
  return (
    <div class="hypatia-chat__empty">
      <div class="hypatia-chat__welcome">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="hypatia-chat__welcome-icon">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <h3 class="hypatia-chat__welcome-title">How can I help?</h3>
        <p class="hypatia-chat__welcome-subtitle">Ask me about your emails, drafts, or campaigns</p>
      </div>

      <div class="hypatia-chat__suggestions">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            class="hypatia-chat__suggestion"
            onClick={() => onPromptClick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isLoading = message.loading;

  return (
    <div class={`hypatia-chat__message hypatia-chat__message--${message.role}`}>
      {!isUser && (
        <div class="hypatia-chat__avatar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
      )}
      <div class="hypatia-chat__message-content">
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          <p>{message.content}</p>
        )}
      </div>
    </div>
  );
}
