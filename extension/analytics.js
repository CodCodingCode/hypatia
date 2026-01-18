/**
 * Hypatia Analytics Module
 * Amplitude integration using HTTP API (CSP-compliant for Chrome extensions)
 */

(function() {
  'use strict';

  // API key loaded from config.js (gitignored)
  const AMPLITUDE_API_KEY = (typeof CONFIG !== 'undefined' && CONFIG.AMPLITUDE_API_KEY) || '';
  const AMPLITUDE_ENDPOINT = 'https://api2.amplitude.com/2/httpapi';

  let currentUserId = null;
  let userProperties = {};
  let sessionId = Date.now();
  let eventQueue = [];
  let flushTimeout = null;

  /**
   * Send events to Amplitude via HTTP API
   */
  async function flushEvents() {
    if (eventQueue.length === 0) return;

    const eventsToSend = [...eventQueue];
    eventQueue = [];

    const payload = {
      api_key: AMPLITUDE_API_KEY,
      events: eventsToSend
    };

    try {
      const response = await fetch(AMPLITUDE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log(`[Hypatia Analytics] Sent ${eventsToSend.length} events`);
      } else {
        const text = await response.text();
        console.warn('[Hypatia Analytics] API error:', response.status, text);
        // Re-queue failed events
        eventQueue = [...eventsToSend, ...eventQueue];
      }
    } catch (error) {
      console.warn('[Hypatia Analytics] Network error:', error.message);
      // Re-queue failed events
      eventQueue = [...eventsToSend, ...eventQueue];
    }
  }

  /**
   * Schedule a flush (batches events for efficiency)
   */
  function scheduleFlush() {
    if (flushTimeout) return;
    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      flushEvents();
    }, 1000); // Flush after 1 second of inactivity
  }

  /**
   * Initialize analytics (optional - starts session)
   */
  function init(userId = null, props = {}) {
    if (userId) {
      currentUserId = userId;
    }
    if (props && Object.keys(props).length > 0) {
      userProperties = { ...userProperties, ...props };
    }
    sessionId = Date.now();
    console.log('[Hypatia Analytics] Initialized', currentUserId ? `for user ${currentUserId.slice(0, 8)}...` : 'anonymously');
  }

  /**
   * Identify user (call after sign-in)
   */
  function identify(userId, props = {}) {
    currentUserId = userId;
    if (props && Object.keys(props).length > 0) {
      userProperties = { ...userProperties, ...props };
    }
    console.log('[Hypatia Analytics] Identified user:', userId.slice(0, 8) + '...');

    // Send an identify event
    trackEvent('$identify', {}, props);
  }

  /**
   * Track an event
   */
  function trackEvent(eventName, properties = {}, userProps = null) {
    const event = {
      event_type: eventName,
      user_id: currentUserId || 'anonymous_' + sessionId,
      session_id: sessionId,
      time: Date.now(),
      platform: 'Chrome Extension',
      event_properties: {
        ...properties,
        source: 'extension',
        url: window.location.href
      }
    };

    // Include user properties if provided or if we have stored ones
    const propsToSend = userProps || (Object.keys(userProperties).length > 0 ? userProperties : null);
    if (propsToSend) {
      event.user_properties = propsToSend;
    }

    eventQueue.push(event);
    console.log('[Hypatia Analytics] Queued:', eventName);

    // Flush immediately if queue is large, otherwise schedule
    if (eventQueue.length >= 10) {
      flushEvents();
    } else {
      scheduleFlush();
    }
  }

  // =============================================================================
  // ONBOARDING EVENTS
  // =============================================================================

  function trackOnboardingStarted() {
    trackEvent('onboarding_started', { step: 'welcome' });
  }

  function trackOnboardingAuthStarted() {
    trackEvent('onboarding_auth_started', { step: 'signing_in' });
  }

  function trackOnboardingAuthCompleted(email) {
    trackEvent('onboarding_auth_completed', {
      step: 'auth_complete',
      email_domain: email ? email.split('@')[1] : null
    });
  }

  function trackQuestionnaireStarted() {
    trackEvent('questionnaire_started', { total_questions: 6 });
  }

  function trackQuestionnaireProgress(questionId, questionNumber, hasAnswer) {
    trackEvent('questionnaire_progress', {
      question_id: questionId,
      question_number: questionNumber,
      has_answer: hasAnswer
    });
  }

  function trackQuestionnaireCompleted(answers) {
    trackEvent('questionnaire_completed', {
      user_type: answers.userType || null,
      referral_source: answers.referralSource || null,
      has_ctas: !!answers.generalCtas,
      has_contacts: !!answers.contactTypes
    });
  }

  function trackOnboardingFinished(emailCount, campaignsCreated) {
    trackEvent('onboarding_finished', {
      email_count: emailCount,
      campaigns_created: campaignsCreated,
      success: campaignsCreated > 0
    });
  }

  // =============================================================================
  // CAMPAIGN EVENTS
  // =============================================================================

  function trackCampaignViewed(campaignId, emailCount) {
    trackEvent('campaign_viewed', {
      campaign_id: campaignId,
      email_count: emailCount || 0
    });
  }

  function trackCampaignCreated(campaignId, isNew) {
    trackEvent('campaign_created', {
      campaign_id: campaignId,
      is_new: isNew
    });
  }

  function trackCampaignAnalyzed(campaignId) {
    trackEvent('campaign_analyzed', { campaign_id: campaignId });
  }

  // =============================================================================
  // LEAD GENERATION EVENTS
  // =============================================================================

  function trackLeadGenerationStarted(campaignId, query) {
    trackEvent('lead_generation_started', {
      campaign_id: campaignId,
      query_length: query?.length || 0,
      query_words: query ? query.split(/\s+/).length : 0
    });
  }

  function trackLeadGenerationCompleted(campaignId, leadsCount, success) {
    trackEvent('lead_generation_completed', {
      campaign_id: campaignId,
      leads_found: leadsCount,
      success: success
    });
  }

  function trackLeadsSelected(campaignId, selectedCount, totalCount) {
    trackEvent('leads_selected', {
      campaign_id: campaignId,
      selected_count: selectedCount,
      total_available: totalCount,
      selection_rate: totalCount > 0 ? (selectedCount / totalCount).toFixed(2) : 0
    });
  }

  // =============================================================================
  // TEMPLATE EVENTS
  // =============================================================================

  function trackTemplateGenerationStarted(campaignId) {
    trackEvent('template_generation_started', { campaign_id: campaignId });
  }

  function trackTemplateGenerated(campaignId, hasSubject, bodyLength) {
    trackEvent('template_generated', {
      campaign_id: campaignId,
      has_subject: hasSubject,
      body_length: bodyLength
    });
  }

  function trackTemplateEdited(campaignId, field) {
    trackEvent('template_edited', {
      campaign_id: campaignId,
      field_edited: field
    });
  }

  function trackTemplateRegenerated(campaignId) {
    trackEvent('template_regenerated', { campaign_id: campaignId });
  }

  // =============================================================================
  // CADENCE EVENTS
  // =============================================================================

  function trackCadenceGenerated(campaignId, emailCount) {
    trackEvent('cadence_generated', {
      campaign_id: campaignId,
      email_count: emailCount
    });
  }

  function trackCadenceEmailEdited(campaignId, emailIndex) {
    trackEvent('cadence_email_edited', {
      campaign_id: campaignId,
      email_index: emailIndex
    });
  }

  // =============================================================================
  // EMAIL SENDING EVENTS
  // =============================================================================

  function trackEmailBatchStarted(campaignId, batchSize) {
    trackEvent('email_batch_started', {
      campaign_id: campaignId,
      batch_size: batchSize
    });
  }

  function trackEmailBatchCompleted(campaignId, sent, failed) {
    trackEvent('email_batch_completed', {
      campaign_id: campaignId,
      sent_count: sent,
      failed_count: failed,
      success_rate: (sent + failed) > 0 ? (sent / (sent + failed)).toFixed(2) : 0
    });
  }

  // =============================================================================
  // FOLLOWUP EVENTS
  // =============================================================================

  function trackFollowupScheduled(campaignId, followupCount) {
    trackEvent('followup_scheduled', {
      campaign_id: campaignId,
      followup_count: followupCount
    });
  }

  function trackFollowupCancelled(followupId, reason) {
    trackEvent('followup_cancelled', {
      followup_id: followupId,
      reason: reason
    });
  }

  // =============================================================================
  // UI NAVIGATION EVENTS
  // =============================================================================

  function trackPanelOpened(source) {
    trackEvent('panel_opened', { source: source });
  }

  function trackPanelClosed() {
    trackEvent('panel_closed', {});
  }

  function trackSidebarNavigation(destination) {
    trackEvent('sidebar_navigation', { destination: destination });
  }

  function trackPageView(page) {
    trackEvent('page_viewed', { page: page });
  }

  // =============================================================================
  // EXPORT
  // =============================================================================

  window.HypatiaAnalytics = {
    // Core
    init,
    identify,
    track: trackEvent,
    flush: flushEvents,

    // Onboarding
    trackOnboardingStarted,
    trackOnboardingAuthStarted,
    trackOnboardingAuthCompleted,
    trackQuestionnaireStarted,
    trackQuestionnaireProgress,
    trackQuestionnaireCompleted,
    trackOnboardingFinished,

    // Campaigns
    trackCampaignViewed,
    trackCampaignCreated,
    trackCampaignAnalyzed,

    // Leads
    trackLeadGenerationStarted,
    trackLeadGenerationCompleted,
    trackLeadsSelected,

    // Templates
    trackTemplateGenerationStarted,
    trackTemplateGenerated,
    trackTemplateEdited,
    trackTemplateRegenerated,

    // Cadence
    trackCadenceGenerated,
    trackCadenceEmailEdited,

    // Email
    trackEmailBatchStarted,
    trackEmailBatchCompleted,

    // Followups
    trackFollowupScheduled,
    trackFollowupCancelled,

    // UI
    trackPanelOpened,
    trackPanelClosed,
    trackSidebarNavigation,
    trackPageView
  };

  // Auto-initialize
  init();
  console.log('[Hypatia Analytics] Ready (HTTP API mode)');

})();
