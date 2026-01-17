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

  const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${endpoint}`, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
  const campaigns = await supabaseRequest(
    `campaigns?user_id=eq.${userId}&select=*&order=email_count.desc`,
    'GET'
  );
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
  if (request.action === 'startOnboarding') {
    handleOnboarding(sender.tab.id);
    return true;
  }

  if (request.action === 'checkOnboardingStatus') {
    checkOnboardingStatus().then(sendResponse);
    return true;
  }

  if (request.action === 'getCampaigns') {
    handleGetCampaigns(request.userId).then(sendResponse);
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
});

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
  try {
    const campaigns = await fetchUserCampaigns(userId);
    return { success: true, campaigns };
  } catch (error) {
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

    // Store completion status locally
    await chrome.storage.local.set({
      onboardingComplete: true,
      userEmail: userInfo.email,
      userId: user.id
    });

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
  const data = await chrome.storage.local.get(['onboardingComplete', 'userEmail']);
  return {
    complete: data.onboardingComplete || false,
    email: data.userEmail || null
  };
}
