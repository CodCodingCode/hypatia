// Hypatia Background Service Worker
// Handles OAuth, Gmail API calls, and Supabase storage

// =============================================================================
// CONFIGURATION
// Load config from separate file (keeps secrets out of main code)
// =============================================================================
importScripts('config.js');

// =============================================================================
// GMAIL API HELPERS
// =============================================================================

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

async function getUserInfo(token) {
  const response = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json();
  return {
    email: data.email,
    googleId: data.id,
    displayName: data.name || data.given_name || ''
  };
}

function getHeaderValue(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

function decodeBase64(data) {
  try {
    const decoded = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return decodeURIComponent(escape(decoded));
  } catch (e) {
    return '';
  }
}

function extractEmailBody(payload) {
  let body = '';

  if (payload.body && payload.body.data) {
    body = decodeBase64(payload.body.data);
  } else if (payload.parts) {
    for (const part of payload.parts) {
      const mimeType = part.mimeType || '';
      if (mimeType === 'text/plain' && part.body && part.body.data) {
        body = decodeBase64(part.body.data);
        break;
      } else if (mimeType === 'text/html' && part.body && part.body.data && !body) {
        body = decodeBase64(part.body.data);
      } else if (part.parts) {
        body = extractEmailBody(part);
        if (body) break;
      }
    }
  }

  return body;
}

async function fetchEmailBatch(token, messageIds, batchSize = 5) {
  // Fetch emails in parallel batches to speed up API calls
  const results = [];

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const batchPromises = batch.map(msgId =>
      fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
        .then(response => response.ok ? response.json() : null)
        .catch(error => {
          console.warn(`Failed to fetch message ${msgId}:`, error.message);
          return null;
        })
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(r => r !== null));

    // Small delay between batches to respect rate limits (250 quota units/sec)
    if (i + batchSize < messageIds.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return results;
}

async function fetchSentEmails(token, onProgress) {
  const BATCH_SIZE = 5; // Fetch 5 emails in parallel

  // Phase 1: Collect all message IDs (fast, metadata only)
  const allMessageIds = [];
  let pageToken = null;

  while (allMessageIds.length < CONFIG.MAX_EMAILS) {
    let url = `https://www.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=${Math.min(100, CONFIG.MAX_EMAILS - allMessageIds.length)}`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    const listResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const listData = await listResponse.json();

    if (!listData.messages || listData.messages.length === 0) {
      break;
    }

    allMessageIds.push(...listData.messages.map(m => m.id));
    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  // Phase 2: Fetch full email details in parallel batches
  const emails = [];
  const totalToFetch = Math.min(allMessageIds.length, CONFIG.MAX_EMAILS);

  for (let i = 0; i < totalToFetch; i += BATCH_SIZE) {
    const batchIds = allMessageIds.slice(i, Math.min(i + BATCH_SIZE, totalToFetch));
    const batchResults = await fetchEmailBatch(token, batchIds, BATCH_SIZE);

    for (const msgData of batchResults) {
      if (!msgData || !msgData.payload) continue;

      const headers = msgData.payload.headers || [];

      const emailData = {
        gmail_id: msgData.id,
        thread_id: msgData.threadId,
        subject: getHeaderValue(headers, 'Subject'),
        recipient_to: getHeaderValue(headers, 'To'),
        recipient_cc: getHeaderValue(headers, 'Cc'),
        recipient_bcc: getHeaderValue(headers, 'Bcc'),
        sent_at: getHeaderValue(headers, 'Date'),
        body: extractEmailBody(msgData.payload)
      };

      emails.push(emailData);
    }

    // Report progress after each batch
    if (onProgress) {
      onProgress(emails.length, totalToFetch);
    }
  }

  return emails;
}

// =============================================================================
// SUPABASE HELPERS
// =============================================================================

async function supabaseRequest(endpoint, method, body = null, extraHeaders = {}) {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/${endpoint}`;
  console.log('[Hypatia] Supabase request:', method, url);

  const options = {
    method,
    headers: {
      'apikey': CONFIG.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...extraHeaders
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    console.error('[Hypatia] Supabase error:', response.status, error);
    throw new Error(`Supabase error: ${error}`);
  }

  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  console.log('[Hypatia] Supabase response:', method, endpoint.split('?')[0], '→', Array.isArray(result) ? result.length + ' rows' : result);
  return result;
}

async function getOrCreateUser(email, googleId) {
  // Try to find existing user
  const existing = await supabaseRequest(
    `users?email=eq.${encodeURIComponent(email)}&select=*`,
    'GET'
  );

  if (existing && existing.length > 0) {
    return existing[0];
  }

  // Create new user
  const created = await supabaseRequest('users', 'POST', {
    email,
    google_id: googleId
  });

  return created[0];
}

async function recoverUserSession() {
  // Auto-recover user session when storage is empty but user exists in Supabase
  // This handles cases where extension storage was cleared/lost
  // IMPORTANT: Uses non-interactive auth to avoid triggering onboarding flow
  console.log('[Hypatia] Attempting session recovery (non-interactive)...');
  try {
    // 1. Try to get cached Google auth token (non-interactive - won't prompt user)
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error('No cached token available'));
        } else {
          resolve(token);
        }
      });
    });

    const userInfo = await getUserInfo(token);
    console.log('[Hypatia] Recovery: Got user info for', userInfo.email);

    // 2. Look up existing user in Supabase by email
    const existingUser = await supabaseRequest(
      `users?email=eq.${encodeURIComponent(userInfo.email)}&select=*`,
      'GET'
    );

    if (existingUser && existingUser.length > 0) {
      // 3. Restore storage (without triggering any onboarding)
      const userId = existingUser[0].id;
      await chrome.storage.local.set({
        userId: userId,
        userEmail: userInfo.email,
        onboardingComplete: true
      });
      console.log('[Hypatia] Recovery successful! Restored userId:', userId);
      return userId;
    }

    console.log('[Hypatia] Recovery failed: User not found in Supabase');
    return null;
  } catch (error) {
    console.log('[Hypatia] Recovery requires re-auth:', error.message);
    return null;
  }
}

async function saveEmailsToSupabase(userId, emails) {
  // Add user_id to each email
  const emailsWithUser = emails.map(email => ({
    ...email,
    user_id: userId
  }));

  // Upsert in batches of 50 to avoid payload limits
  // Uses on_conflict to ignore duplicates (user_id, gmail_id)
  const batchSize = 50;
  for (let i = 0; i < emailsWithUser.length; i += batchSize) {
    const batch = emailsWithUser.slice(i, i + batchSize);
    // Use upsert with ignoreDuplicates - Prefer header tells Supabase to handle conflicts
    await supabaseRequest(
      'sent_emails?on_conflict=user_id,gmail_id',
      'POST',
      batch,
      { 'Prefer': 'resolution=ignore-duplicates,return=representation' }
    );
  }
}

async function markOnboardingComplete(userId) {
  await supabaseRequest(
    `users?id=eq.${userId}`,
    'PATCH',
    { onboarding_completed: true }
  );
}

async function saveQuestionnaireAnswers(userId, answers) {
  await supabaseRequest(
    `users?id=eq.${userId}`,
    'PATCH',
    {
      display_name: answers.displayName,
      name_confirmed: answers.nameConfirmed,
      app_purpose: answers.appPurpose,
      user_type: answers.userType,
      general_ctas: answers.generalCtas || null,
      contact_types: answers.contactTypes || null,
      referral_source: answers.referralSource,
      questionnaire_completed_at: new Date().toISOString()
    }
  );
}

async function getExistingEmailCount(userId) {
  // Check how many emails already exist for this user
  const result = await supabaseRequest(
    `sent_emails?user_id=eq.${userId}&select=id`,
    'GET'
  );
  return result ? result.length : 0;
}

// =============================================================================
// BACKEND API HELPERS (for clustering)
// =============================================================================

async function clusterUserEmails(userId) {
  const response = await fetch(`${CONFIG.API_URL}/campaigns/cluster`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user_id: userId })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Clustering error: ${error}`);
  }

  return response.json();
}

async function analyzeUserCampaigns(userId) {
  /**
   * Call the analysis endpoint to run CTA, contact, and style analysis
   * on the user's campaigns. Returns enriched campaign data.
   */
  const response = await fetch(`${CONFIG.API_URL}/campaigns/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user_id: userId })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Analysis error: ${error}`);
  }

  return response.json();
}

async function fetchUserCampaigns(userId) {
  console.log('[Hypatia] Fetching campaigns for userId:', userId);

  // Fetch campaigns with related analysis data (CTA, style, contacts) using Supabase joins
  const campaigns = await supabaseRequest(
    `campaigns?user_id=eq.${userId}&select=*,campaign_ctas(*),campaign_email_styles(*),campaign_contacts(*)&order=email_count.desc`,
    'GET'
  );

  console.log('[Hypatia] Supabase returned campaigns:', campaigns?.length || 0, campaigns);

  // Flatten the nested analysis data for easier access in the frontend
  if (campaigns && campaigns.length > 0) {
    // Fetch emails for each campaign in parallel
    const campaignsWithEmails = await Promise.all(campaigns.map(async (campaign) => {
      const cta = campaign.campaign_ctas?.[0] || campaign.campaign_ctas || {};
      const style = campaign.campaign_email_styles?.[0] || campaign.campaign_email_styles || {};
      const contact = campaign.campaign_contacts?.[0] || campaign.campaign_contacts || {};

      // Fetch emails for this campaign
      const emails = await fetchCampaignEmails(campaign.id);

      return {
        ...campaign,
        // CTA fields
        cta_type: cta.cta_type || campaign.cta_type,
        cta_description: cta.cta_description || campaign.cta_description,
        cta_text: cta.cta_text || campaign.cta_text,
        cta_urgency: cta.urgency || campaign.cta_urgency,
        // Style fields
        style_description: style.one_sentence_description || campaign.style_description,
        style_prompt: style.style_analysis_prompt || campaign.style_prompt,
        // Contact fields
        contact_description: contact.contact_description || campaign.contact_description,
        // Emails for this campaign
        emails: emails || [],
        // Remove nested objects to keep payload clean
        campaign_ctas: undefined,
        campaign_email_styles: undefined,
        campaign_contacts: undefined
      };
    }));

    return campaignsWithEmails;
  }

  return campaigns || [];
}

async function fetchCampaignEmails(campaignId) {
  // Get emails linked to a specific campaign
  const emailCampaigns = await supabaseRequest(
    `email_campaigns?campaign_id=eq.${campaignId}&select=email_id`,
    'GET'
  );

  if (!emailCampaigns || emailCampaigns.length === 0) {
    return [];
  }

  const emailIds = emailCampaigns.map(ec => ec.email_id);
  const emails = await supabaseRequest(
    `sent_emails?id=in.(${emailIds.join(',')})&select=id,thread_id,subject,recipient_to,sent_at`,
    'GET'
  );

  return emails || [];
}

// =============================================================================
// MESSAGE HANDLER
// =============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Hypatia BG] Message received:', request.action, 'from tab:', sender?.tab?.id);

  if (request.action === 'startOnboarding') {
    console.log('[Hypatia BG] Starting onboarding for tab:', sender?.tab?.id);
    if (!sender?.tab?.id) {
      console.error('[Hypatia BG] No tab ID available!');
      return true;
    }
    handleOnboarding(sender.tab.id);
    return true;
  }

  if (request.action === 'checkOnboardingStatus') {
    checkOnboardingStatus().then(sendResponse);
    return true;
  }

  if (request.action === 'getCampaigns') {
    handleGetCampaigns(request.userId)
      .then(sendResponse)
      .catch(err => {
        console.error('[Hypatia] getCampaigns message handler error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === 'getCampaignEmails') {
    fetchCampaignEmails(request.campaignId).then(sendResponse);
    return true;
  }

  if (request.action === 'submitQuestionnaire') {
    handleQuestionnaireSubmission(request.userId, request.answers).then(sendResponse);
    return true;
  }

  if (request.action === 'markOnboardingDone') {
    markOnboardingComplete(request.userId).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'updateCampaign') {
    updateCampaignFields(request.campaignId, request.fields).then(sendResponse);
    return true;
  }

  if (request.action === 'createCampaign') {
    createNewCampaign(request.userId, request.campaignData).then(sendResponse);
    return true;
  }

  // Followup system handlers
  if (request.action === 'createFollowupPlan') {
    handleCreateFollowupPlan(request.userId, request.campaignId, request.emails)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'getFollowupStatus') {
    handleGetFollowupStatus(request.userId).then(sendResponse);
    return true;
  }

  if (request.action === 'cancelFollowup') {
    handleCancelFollowup(request.followupId).then(sendResponse);
    return true;
  }

  if (request.action === 'syncGmailToken') {
    syncGmailTokenToBackend(request.userId).then(success => sendResponse({ success }));
    return true;
  }

  if (request.action === 'setupGmailWatch') {
    setupGmailWatch(request.userId, request.topicName).then(sendResponse);
    return true;
  }

  if (request.action === 'signOut') {
    handleSignOut().then(sendResponse);
    return true;
  }

  if (request.action === 'generateLeads') {
    handleGenerateLeads(request.userId, request.campaignId, request.query, request.limit)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'generateTemplate') {
    handleGenerateTemplate(request.userId, request.campaignId, request.cta, request.stylePrompt, request.sampleEmails, request.currentSubject, request.currentBody)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'generateCadence') {
    handleGenerateCadence(request.userId, request.campaignId, request.stylePrompt, request.sampleEmails, request.timing)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'updateCadenceEmail') {
    handleUpdateCadenceEmail(request.cadenceId, request.updates)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'regenerateCadenceEmail') {
    handleRegenerateCadenceEmail(request.cadenceId, request.userId)
      .then(sendResponse);
    return true;
  }

  // Fetch saved AI-generated content
  if (request.action === 'getSavedContent') {
    handleGetSavedContent(request.userId, request.campaignId)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'getSavedLeads') {
    handleGetSavedLeads(request.userId, request.campaignId)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'getSavedTemplate') {
    handleGetSavedTemplate(request.campaignId)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'getSavedCTAs') {
    handleGetSavedCTAs(request.campaignId)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'getAllTemplates') {
    handleGetAllTemplates(request.userId)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'sendEmailBatch') {
    handleSendEmailBatch(request.userId, request.campaignId, request.emails)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'sendSingleEmail') {
    handleSendSingleEmail(request.userId, request.campaignId, request.email)
      .then(sendResponse);
    return true;
  }

  if (request.action === 'analyzeContactPreference') {
    handleAnalyzeContactPreference(request.text)
      .then(sendResponse);
    return true;
  }
});

// =============================================================================
// SIGN OUT HANDLER
// Clears all OAuth tokens and local storage for fresh re-authentication
// =============================================================================

async function handleSignOut() {
  try {
    // Step 1: Get current token before clearing (non-interactive)
    let token = null;
    try {
      token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          if (chrome.runtime.lastError) {
            resolve(null); // No token cached, that's fine
          } else {
            resolve(t);
          }
        });
      });
    } catch (e) {
      console.log('[Hypatia] No cached token found during sign out');
    }

    // Step 2: Remove cached auth token from Chrome identity
    if (token) {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          console.log('[Hypatia] Removed cached auth token');
          resolve();
        });
      });

      // Step 3: Revoke token with Google (prevents token reuse)
      try {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
        console.log('[Hypatia] Token revoked with Google');
      } catch (revokeError) {
        // Non-fatal: token removal still succeeded
        console.warn('[Hypatia] Token revocation failed (non-fatal):', revokeError.message);
      }
    }

    // Step 4: Clear all chrome.storage.local data
    await chrome.storage.local.remove([
      'onboardingComplete',
      'userEmail',
      'userId',
      'hypatia_sidebar_collapsed'
    ]);
    console.log('[Hypatia] Cleared local storage');

    // Step 5: Clear all cached auth tokens completely (forces re-auth on next sign in)
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => {
        console.log('[Hypatia] Cleared all cached auth tokens');
        resolve();
      });
    });

    return { success: true };
  } catch (error) {
    console.error('[Hypatia] Sign out error:', error);
    return { success: false, error: error.message };
  }
}

async function handleQuestionnaireSubmission(userId, answers) {
  try {
    await saveQuestionnaireAnswers(userId, answers);
    return { success: true };
  } catch (error) {
    console.error('Failed to save questionnaire:', error);
    return { success: false, error: error.message };
  }
}

async function handleGetCampaigns(userId) {
  console.log('[Hypatia] handleGetCampaigns called with userId:', userId);
  try {
    // Auto-recover if userId is missing (storage was cleared)
    if (!userId) {
      console.log('[Hypatia] No userId provided, attempting session recovery...');
      userId = await recoverUserSession();
      if (!userId) {
        return { success: false, error: 'Please sign in again', needsReauth: true };
      }
    }

    const campaigns = await fetchUserCampaigns(userId);
    console.log('[Hypatia] handleGetCampaigns returning:', campaigns?.length || 0, 'campaigns');
    return { success: true, campaigns };
  } catch (error) {
    console.error('[Hypatia] handleGetCampaigns error:', error);
    return { success: false, error: error.message };
  }
}

async function updateCampaignFields(campaignId, fields) {
  /**
   * Update campaign CTA and/or contact description in Supabase.
   * fields can contain: cta_description, contact_description
   */
  try {
    // Update CTA description if provided
    if (fields.cta_description !== undefined) {
      // Check if campaign_ctas entry exists
      const existingCta = await supabaseRequest(
        `campaign_ctas?campaign_id=eq.${campaignId}&select=id`,
        'GET'
      );

      if (existingCta && existingCta.length > 0) {
        // Update existing
        await supabaseRequest(
          `campaign_ctas?campaign_id=eq.${campaignId}`,
          'PATCH',
          { cta_description: fields.cta_description }
        );
      } else {
        // Insert new
        await supabaseRequest(
          'campaign_ctas',
          'POST',
          { campaign_id: campaignId, cta_description: fields.cta_description }
        );
      }
    }

    // Update contact description if provided
    if (fields.contact_description !== undefined) {
      // Check if campaign_contacts entry exists
      const existingContact = await supabaseRequest(
        `campaign_contacts?campaign_id=eq.${campaignId}&select=id`,
        'GET'
      );

      if (existingContact && existingContact.length > 0) {
        // Update existing
        await supabaseRequest(
          `campaign_contacts?campaign_id=eq.${campaignId}`,
          'PATCH',
          { contact_description: fields.contact_description }
        );
      } else {
        // Insert new
        await supabaseRequest(
          'campaign_contacts',
          'POST',
          { campaign_id: campaignId, contact_description: fields.contact_description }
        );
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to update campaign fields:', error);
    return { success: false, error: error.message };
  }
}

async function createNewCampaign(userId, campaignData) {
  /**
   * Create a new campaign in Supabase and optionally set CTA/contact descriptions.
   * campaignData can contain: representative_subject, representative_recipient, cta_description, contact_description
   */
  try {
    // Get the next campaign_number for this user
    const existingCampaigns = await supabaseRequest(
      `campaigns?user_id=eq.${userId}&select=campaign_number&order=campaign_number.desc&limit=1`,
      'GET'
    );
    const nextCampaignNumber = (existingCampaigns && existingCampaigns.length > 0)
      ? existingCampaigns[0].campaign_number + 1
      : 1;

    // Create the campaign record
    const result = await supabaseRequest(
      'campaigns',
      'POST',
      {
        user_id: userId,
        campaign_number: nextCampaignNumber,
        representative_subject: campaignData.representative_subject || 'New Campaign',
        representative_recipient: campaignData.representative_recipient || '',
        email_count: 0
      }
    );

    console.log('[Hypatia] Create campaign result:', result);

    // Supabase POST returns an array
    const newCampaign = Array.isArray(result) ? result[0] : result;
    if (!newCampaign || !newCampaign.id) {
      throw new Error('Failed to create campaign - no ID returned');
    }

    const campaignId = newCampaign.id;
    console.log('[Hypatia] Created new campaign with ID:', campaignId);

    // Save CTA description if provided
    if (campaignData.cta_description) {
      await supabaseRequest(
        'campaign_ctas',
        'POST',
        { campaign_id: campaignId, cta_description: campaignData.cta_description }
      );
    }

    // Save contact description if provided
    if (campaignData.contact_description) {
      await supabaseRequest(
        'campaign_contacts',
        'POST',
        { campaign_id: campaignId, contact_description: campaignData.contact_description }
      );
    }

    return { success: true, campaignId: campaignId, campaign: newCampaign };
  } catch (error) {
    console.error('Failed to create campaign:', error);
    return { success: false, error: error.message };
  }
}

async function handleOnboarding(tabId) {
  try {
    // Step 1: Get OAuth token
    sendProgressToTab(tabId, { step: 'auth', message: 'Authenticating...' });
    const token = await getAuthToken();

    // Step 2: Get user info (now includes displayName)
    const userInfo = await getUserInfo(token);
    sendProgressToTab(tabId, {
      step: 'auth',
      message: 'Authenticated!',
      email: userInfo.email,
      displayName: userInfo.displayName
    });

    // Step 3: Create/get user in Supabase
    sendProgressToTab(tabId, { step: 'setup', message: 'Setting up your account...' });
    const user = await getOrCreateUser(userInfo.email, userInfo.googleId);

    // Step 3.5: Sync Gmail token to backend for followup system
    // This runs in background, doesn't block onboarding
    syncGmailTokenToBackend(user.id).catch(err => {
      console.warn('Initial token sync failed (non-fatal):', err.message);
    });

    // Step 4: Send signal to start questionnaire AND begin backend processing in parallel
    sendProgressToTab(tabId, {
      step: 'questionnaire_start',
      userId: user.id,
      displayName: userInfo.displayName,
      email: userInfo.email
    });

    // Step 5: Run backend processing (runs while user fills questionnaire)
    const backendResult = await runBackendProcessing(token, user.id, tabId);

    // Step 6: Notify that backend is complete
    sendProgressToTab(tabId, {
      step: 'backend_complete',
      emailCount: backendResult.emailCount,
      campaignsCreated: backendResult.campaignsCreated,
      campaigns: backendResult.campaigns
    });

    // Only mark onboarding complete if we have campaigns
    // Otherwise the user will see "No email categories found" on reload
    if (backendResult.campaigns && backendResult.campaigns.length > 0) {
      await chrome.storage.local.set({
        onboardingComplete: true,
        userEmail: userInfo.email,
        userId: user.id
      });
      console.log('[Hypatia] Onboarding complete with', backendResult.campaigns.length, 'campaigns');
    } else {
      console.warn('[Hypatia] No campaigns created - not marking onboarding complete');
      // Still store userId for debugging but not complete status
      await chrome.storage.local.set({
        userEmail: userInfo.email,
        userId: user.id
      });
    }

  } catch (error) {
    console.error('Onboarding error:', error.message || JSON.stringify(error));
    sendProgressToTab(tabId, {
      step: 'error',
      message: error.message || 'An error occurred during onboarding'
    });
  }
}

async function runBackendProcessing(token, userId, tabId) {
  // Check if emails already exist for this user
  const existingEmailCount = await getExistingEmailCount(userId);
  let emailCount = existingEmailCount;

  if (existingEmailCount > 0) {
    console.log(`Found ${existingEmailCount} existing emails, skipping fetch`);
    sendProgressToTab(tabId, {
      step: 'backend_progress',
      phase: 'fetching',
      message: `Found ${existingEmailCount} existing emails...`,
      current: existingEmailCount,
      total: existingEmailCount
    });
  } else {
    // No emails yet - fetch from Gmail
    sendProgressToTab(tabId, {
      step: 'backend_progress',
      phase: 'fetching',
      message: 'Fetching your sent emails...',
      current: 0,
      total: CONFIG.MAX_EMAILS
    });

    const emails = await fetchSentEmails(token, (current, total) => {
      sendProgressToTab(tabId, {
        step: 'backend_progress',
        phase: 'fetching',
        current,
        total
      });
    });

    // Save to Supabase
    sendProgressToTab(tabId, {
      step: 'backend_progress',
      phase: 'saving',
      message: 'Saving your emails...'
    });
    await saveEmailsToSupabase(userId, emails);
    emailCount = emails.length;
  }

  // Check if campaigns already exist for this user
  const existingCampaigns = await fetchUserCampaigns(userId);
  if (existingCampaigns && existingCampaigns.length > 0) {
    console.log(`Found ${existingCampaigns.length} existing campaigns, skipping clustering`);
    sendProgressToTab(tabId, {
      step: 'backend_progress',
      phase: 'complete',
      message: `Found ${existingCampaigns.length} existing categories`
    });
    return {
      emailCount,
      campaignsCreated: existingCampaigns.length,
      campaigns: existingCampaigns
    };
  }

  // Cluster emails into campaigns
  sendProgressToTab(tabId, {
    step: 'backend_progress',
    phase: 'clustering',
    message: 'Grouping emails into categories...'
  });

  let clusterResult = null;
  try {
    clusterResult = await clusterUserEmails(userId);
  } catch (clusterError) {
    console.warn('Clustering failed (non-fatal):', clusterError.message);
    // Continue even if clustering fails - emails are saved
  }

  // Analyze campaigns (CTA, contacts, style)
  let analyzedCampaigns = clusterResult?.campaigns || [];
  if (clusterResult?.campaigns_created > 0) {
    sendProgressToTab(tabId, {
      step: 'backend_progress',
      phase: 'analyzing',
      message: 'Learning your email patterns...'
    });

    try {
      const analysisResult = await analyzeUserCampaigns(userId);
      if (analysisResult?.campaigns) {
        analyzedCampaigns = analysisResult.campaigns;
      }
    } catch (analysisError) {
      console.warn('Analysis failed (non-fatal):', analysisError.message);
      // Continue with basic campaign data if analysis fails
    }
  }

  return {
    emailCount,
    campaignsCreated: clusterResult?.campaigns_created || 0,
    campaigns: analyzedCampaigns
  };
}

function sendProgressToTab(tabId, data) {
  chrome.tabs.sendMessage(tabId, { action: 'onboardingProgress', ...data });
}

async function checkOnboardingStatus() {
  const data = await chrome.storage.local.get(['onboardingComplete', 'userEmail', 'userId']);

  // If storage is empty but user might be logged in, try to recover
  if (!data.userId) {
    console.log('[Hypatia] No userId in storage, attempting auto-recovery...');
    const recoveredUserId = await recoverUserSession();
    if (recoveredUserId) {
      // Re-read storage after recovery
      const newData = await chrome.storage.local.get(['onboardingComplete', 'userEmail', 'userId']);
      return {
        complete: newData.onboardingComplete || false,
        email: newData.userEmail || null,
        userId: newData.userId || null
      };
    }
  }

  return {
    complete: data.onboardingComplete || false,
    email: data.userEmail || null,
    userId: data.userId || null
  };
}

// =============================================================================
// GMAIL TOKEN RELAY FOR FOLLOWUP SYSTEM
// Syncs OAuth tokens to backend for server-side email sending
// =============================================================================

async function syncGmailTokenToBackend(userId) {
  /**
   * Push Gmail OAuth token to backend for followup sending.
   * Called after initial auth and periodically to refresh.
   */
  try {
    const token = await getAuthToken();

    // Chrome doesn't expose exact expiration, so we set a conservative 55 min
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();

    const response = await fetch(`${CONFIG.API_URL}/users/${userId}/gmail-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        expires_at: expiresAt
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to sync Gmail token:', error);
      return false;
    }

    console.log('Gmail token synced to backend');
    return true;
  } catch (error) {
    console.error('Failed to sync Gmail token:', error);
    return false;
  }
}

async function setupGmailWatch(userId, topicName) {
  /**
   * Set up Gmail push notifications for reply detection.
   * topicName should be the full Pub/Sub topic path.
   */
  try {
    const response = await fetch(`${CONFIG.API_URL}/users/${userId}/gmail-watch?topic_name=${encodeURIComponent(topicName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to set up Gmail watch:', error);
      return { success: false, error };
    }

    const result = await response.json();
    console.log('Gmail watch set up successfully:', result);
    return { success: true, ...result };
  } catch (error) {
    console.error('Failed to set up Gmail watch:', error);
    return { success: false, error: error.message };
  }
}

// Set up periodic token refresh (every 45 minutes)
// This ensures the backend always has a valid token for sending followups
setInterval(async () => {
  const data = await chrome.storage.local.get(['userId']);
  if (data.userId) {
    await syncGmailTokenToBackend(data.userId);
  }
}, 45 * 60 * 1000);

// =============================================================================
// FOLLOWUP API HANDLERS
// =============================================================================

async function handleCreateFollowupPlan(userId, campaignId, emails) {
  try {
    const response = await fetch(`${CONFIG.API_URL}/followups/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        emails: emails
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${error}`);
    }

    return { success: true, data: await response.json() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleGetFollowupStatus(userId) {
  try {
    const response = await fetch(`${CONFIG.API_URL}/followups/pending/${userId}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${error}`);
    }

    return { success: true, data: await response.json() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleCancelFollowup(followupId) {
  try {
    const response = await fetch(`${CONFIG.API_URL}/followups/${followupId}/cancel`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${error}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// LEAD GENERATION HANDLERS
// =============================================================================

async function handleGenerateLeads(userId, campaignId, query, limit = 20) {
  /**
   * Generate leads using PeopleFinderAgent via the backend API.
   * Returns contacts matching the natural language query.
   */
  try {
    console.log('[Hypatia] Generating leads:', { userId, campaignId, query, limit });

    const response = await fetch(`${CONFIG.API_URL}/leads/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        query: query,
        limit: limit
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hypatia] Lead generation failed:', error);
      throw new Error(`Lead generation failed: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Generated leads:', result.count);

    return { success: true, leads: result.leads, count: result.count };
  } catch (error) {
    console.error('[Hypatia] Lead generation error:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// TEMPLATE GENERATION HANDLERS
// =============================================================================

async function handleGenerateTemplate(userId, campaignId, cta, stylePrompt, sampleEmails = [], currentSubject = null, currentBody = null) {
  /**
   * Generate an email template using the DebateOrchestrator via the backend API.
   * Runs a multi-agent debate to create an optimized template.
   */
  try {
    console.log('[Hypatia] Generating template:', { userId, campaignId, cta: cta?.substring(0, 50) });

    const response = await fetch(`${CONFIG.API_URL}/templates/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        cta: cta,
        style_prompt: stylePrompt,
        sample_emails: sampleEmails,
        current_subject: currentSubject,
        current_body: currentBody
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hypatia] Template generation failed:', error);
      throw new Error(`Template generation failed: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Generated template:', result.template?.subject, 'template_id:', result.template_id);

    return { success: true, template: result.template, template_id: result.template_id };
  } catch (error) {
    console.error('[Hypatia] Template generation error:', error);
    return { success: false, error: error.message };
  }
}

async function handleGenerateCadence(userId, campaignId, stylePrompt, sampleEmails = [], timing = {}) {
  /**
   * Generate email cadence (initial + 3 follow-ups) using AI via the backend API.
   * Returns 4 emails with configurable timing.
   */
  try {
    console.log('[Hypatia] Generating cadence:', { userId, campaignId });

    const response = await fetch(`${CONFIG.API_URL}/cadence/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        style_prompt: stylePrompt,
        sample_emails: sampleEmails,
        day_1: timing.day_1 || 1,
        day_2: timing.day_2 || 3,
        day_3: timing.day_3 || 7,
        day_4: timing.day_4 || 14,
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hypatia] Cadence generation failed:', error);
      throw new Error(`Cadence generation failed: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Generated cadence:', result.cadence?.length, 'emails');

    return { success: true, cadence: result.cadence };
  } catch (error) {
    console.error('[Hypatia] Cadence generation error:', error);
    return { success: false, error: error.message };
  }
}

async function handleUpdateCadenceEmail(cadenceId, updates) {
  /**
   * Update a single cadence email (timing, subject, or body).
   */
  try {
    const response = await fetch(`${CONFIG.API_URL}/cadence/${cadenceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      throw new Error('Failed to update cadence email');
    }

    const result = await response.json();
    return { success: true, updated: result.updated };
  } catch (error) {
    console.error('[Hypatia] Update cadence error:', error);
    return { success: false, error: error.message };
  }
}

async function handleRegenerateCadenceEmail(cadenceId, userId) {
  /**
   * Regenerate a single cadence email with fresh AI content.
   */
  try {
    const response = await fetch(`${CONFIG.API_URL}/cadence/${cadenceId}/regenerate?user_id=${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to regenerate cadence email');
    }

    const result = await response.json();
    return { success: true, email: result.email };
  } catch (error) {
    console.error('[Hypatia] Regenerate cadence error:', error);
    return { success: false, error: error.message };
  }
}


// =============================================================================
// SAVED CONTENT RETRIEVAL HANDLERS
// =============================================================================

async function handleGetSavedContent(userId, campaignId) {
  /**
   * Fetch all saved AI-generated content for a campaign in one call.
   * Returns leads, template, and CTAs.
   */
  try {
    console.log('[Hypatia] Fetching saved content:', { userId, campaignId });

    const response = await fetch(
      `${CONFIG.API_URL}/campaigns/${campaignId}/saved-content?user_id=${userId}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hypatia] Failed to fetch saved content:', error);
      throw new Error(`Failed to fetch saved content: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Fetched saved content:', {
      leadsCount: result.leads?.length,
      hasTemplate: !!result.template,
      ctasCount: result.ctas?.length
    });

    return {
      success: true,
      leads: result.leads || [],
      template: result.template,
      ctas: result.ctas || [],
      hasSavedContent: result.has_saved_content
    };
  } catch (error) {
    console.error('[Hypatia] Error fetching saved content:', error);
    return { success: false, error: error.message };
  }
}

async function handleGetSavedLeads(userId, campaignId = null) {
  /**
   * Fetch saved generated leads for a user/campaign.
   */
  try {
    console.log('[Hypatia] Fetching saved leads:', { userId, campaignId });

    let url = `${CONFIG.API_URL}/leads/${userId}`;
    if (campaignId) {
      url += `?campaign_id=${campaignId}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch leads: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Fetched saved leads:', result.count);

    return { success: true, leads: result.leads || [], count: result.count };
  } catch (error) {
    console.error('[Hypatia] Error fetching saved leads:', error);
    return { success: false, error: error.message };
  }
}

async function handleGetSavedTemplate(campaignId) {
  /**
   * Fetch saved generated template for a campaign.
   */
  try {
    console.log('[Hypatia] Fetching saved template:', { campaignId });

    const response = await fetch(`${CONFIG.API_URL}/templates/${campaignId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch template: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Fetched saved template:', result.template ? 'found' : 'not found');

    return { success: true, template: result.template };
  } catch (error) {
    console.error('[Hypatia] Error fetching saved template:', error);
    return { success: false, error: error.message };
  }
}

async function handleGetSavedCTAs(campaignId) {
  /**
   * Fetch saved generated CTAs for a campaign.
   */
  try {
    console.log('[Hypatia] Fetching saved CTAs:', { campaignId });

    const response = await fetch(`${CONFIG.API_URL}/ctas/${campaignId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch CTAs: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Fetched saved CTAs:', result.ctas?.length);

    return { success: true, ctas: result.ctas || [] };
  } catch (error) {
    console.error('[Hypatia] Error fetching saved CTAs:', error);
    return { success: false, error: error.message };
  }
}

async function handleGetAllTemplates(userId) {
  /**
   * Fetch all saved templates for a user (for templates list view).
   */
  try {
    console.log('[Hypatia] Fetching all templates for user:', userId);

    const response = await fetch(`${CONFIG.API_URL}/templates/user/${userId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch templates: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Fetched all templates:', result.count);

    return { success: true, templates: result.templates || [], count: result.count };
  } catch (error) {
    console.error('[Hypatia] Error fetching all templates:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// EMAIL SENDING HANDLERS
// =============================================================================

async function handleSendEmailBatch(userId, campaignId, emails) {
  /**
   * Send a batch of emails via the backend API.
   * Syncs Gmail token first to ensure it's valid.
   */
  try {
    console.log('[Hypatia] Sending email batch:', { userId, campaignId, count: emails.length });

    // First ensure Gmail token is fresh
    await syncGmailTokenToBackend(userId);

    const response = await fetch(`${CONFIG.API_URL}/emails/send-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        emails: emails
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hypatia] Send batch failed:', error);

      // Check for auth errors
      if (response.status === 401) {
        return { success: false, error: 'Gmail authentication expired. Please sign out and sign back in.', authError: true };
      }

      throw new Error(`Send failed: ${error}`);
    }

    const result = await response.json();
    console.log('[Hypatia] Send batch result:', { sent: result.sent, failed: result.failed });

    return { success: true, data: result };
  } catch (error) {
    console.error('[Hypatia] Send batch error:', error);
    return { success: false, error: error.message };
  }
}

async function handleSendSingleEmail(userId, campaignId, email) {
  /**
   * Send a single email via the backend API.
   * Used for real-time progress updates when sending one-by-one.
   */
  try {
    // First ensure Gmail token is fresh
    await syncGmailTokenToBackend(userId);

    const response = await fetch(`${CONFIG.API_URL}/emails/send-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        emails: [email]
      })
    });

    if (!response.ok) {
      const error = await response.text();

      if (response.status === 401) {
        return { success: false, error: 'Gmail authentication expired', authError: true };
      }

      throw new Error(`Send failed: ${error}`);
    }

    const result = await response.json();
    const emailResult = result.results[0];

    return {
      success: emailResult.success,
      gmail_id: emailResult.gmail_id,
      thread_id: emailResult.thread_id,
      error: emailResult.error
    };
  } catch (error) {
    console.error('[Hypatia] Send single email error:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// CONTACT PREFERENCE ANALYSIS (Groq)
// Analyzes contact preference text to detect presence of key categories
// =============================================================================

async function handleAnalyzeContactPreference(text) {
  /**
   * Use Groq's fast LLM to analyze contact preference text.
   * Returns which categories are present: Location, Job Title, Experience, Education, Industry, Skills
   */
  if (!text || text.trim().length < 3) {
    return {
      success: true,
      categories: {
        location: false,
        job_title: false,
        experience: false,
        education: false,
        industry: false,
        skills: false
      }
    };
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `You analyze contact preference descriptions to identify which targeting categories are mentioned.

Respond ONLY with a JSON object with these exact keys, each true or false:
- location: geographic location, city, region, country mentioned
- job_title: specific job titles, roles, or positions mentioned
- experience: company stage, company size, or company maturity mentioned (e.g., "Series A", "Fortune 500", "startups", "enterprise")
- education: degrees, schools, certifications, educational background mentioned
- industry: EXPLICIT mention of a specific sector or vertical (e.g., "healthcare", "fintech", "real estate", "SaaS")
- skills: specific skills, technologies, or competencies mentioned

Example input: "CTOs at Series A startups in San Francisco"
Example output: {"location":true,"job_title":true,"experience":true,"education":false,"industry":false,"skills":false}`
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0,
        max_tokens: 100
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Hypatia] Groq API error:', error);
      throw new Error(`Groq API error: ${error}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '{}';

    // Parse the JSON response
    let categories;
    try {
      categories = JSON.parse(content);
    } catch (parseError) {
      console.warn('[Hypatia] Failed to parse Groq response:', content);
      categories = {
        location: false,
        job_title: false,
        experience: false,
        education: false,
        industry: false,
        skills: false
      };
    }

    console.log('[Hypatia] Contact preference analysis:', categories);
    return { success: true, categories };
  } catch (error) {
    console.error('[Hypatia] Contact preference analysis error:', error);
    return { success: false, error: error.message };
  }
}
