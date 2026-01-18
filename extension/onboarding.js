// Hypatia Onboarding Module
// Contains onboarding flow UI and questionnaire logic
// Note: This module shares globals with content.js - variables defined here
// are used by both files. This file loads first per manifest.json.

// =============================================================================
// SHARED STATE (used by both onboarding.js and content.js)
// =============================================================================

let userDisplayName = '';
let questionnaireState = {
  currentQuestion: 0,
  answers: {
    displayName: '',
    nameConfirmed: false,
    appPurpose: '',
    userType: '',
    generalCtas: '',
    contactTypes: '',
    referralSource: ''
  },
  isComplete: false
};
let backendState = {
  isComplete: false,
  emailCount: 0,
  campaignsCreated: 0,
  campaigns: []
};

// =============================================================================
// QUESTIONNAIRE CONFIGURATION
// =============================================================================

// Questionnaire questions configuration
const QUESTIONNAIRE_QUESTIONS = [
  {
    id: 'name',
    title: 'Is this your name?',
    type: 'name_confirm',
    required: true
  },
  {
    id: 'purpose',
    title: 'What will you use the app for?',
    type: 'text',
    placeholder: 'e.g., Managing client communications, personal email organization...',
    required: true
  },
  {
    id: 'userType',
    title: 'Who are you?',
    type: 'select',
    options: [
      { value: 'student', label: 'Student' },
      { value: 'professional', label: 'Professional' },
      { value: 'business_owner', label: 'Business Owner' },
      { value: 'freelancer', label: 'Freelancer' },
      { value: 'other', label: 'Other' }
    ],
    required: true
  },
  {
    id: 'ctas',
    title: 'What kind of general CTAs do you have?',
    type: 'text',
    placeholder: 'e.g., Schedule meetings, request feedback, send proposals...',
    required: false,
    hint: 'Optional - helps us understand your workflow'
  },
  {
    id: 'contacts',
    title: 'What kind of people do you generally contact?',
    type: 'text',
    placeholder: 'e.g., Clients, colleagues, vendors, friends...',
    required: false,
    hint: 'Optional - helps personalize your experience'
  },
  {
    id: 'referral',
    title: 'Where did you find this app?',
    type: 'select',
    options: [
      { value: 'google_search', label: 'Google Search' },
      { value: 'seo', label: 'Blog / Article' },
      { value: 'facebook', label: 'Facebook' },
      { value: 'twitter', label: 'Twitter / X' },
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'friend', label: 'Friend / Colleague' },
      { value: 'product_hunt', label: 'Product Hunt' },
      { value: 'other', label: 'Other' }
    ],
    required: true
  }
];

// Clustering phase messages that rotate for entertainment
const CLUSTERING_MESSAGES = [
  'Grouping emails into categories...',
  'Finding patterns in your emails...',
  'Analyzing writing styles...',
  'Discovering email clusters...',
  'Comparing message similarity...',
  'Organizing your conversations...',
  'Identifying unique campaigns...',
  'Connecting the dots...',
  'Almost there...',
];

// clusteringAnimationInterval is defined in content.js

// =============================================================================
// ONBOARDING STEP RENDERERS
// =============================================================================

function getLoadingStep() {
  return `
    <div class="hypatia-step hypatia-loading">
      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>
      <p class="hypatia-subtitle">Loading...</p>
    </div>
  `;
}

function getSigningInStep() {
  return `
    <div class="hypatia-step hypatia-signing-in">
      <div class="hypatia-logo">
        <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" stroke="#4285f4" stroke-width="3" fill="none"/>
          <path d="M20 32 L28 40 L44 24" stroke="#4285f4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>

      <h1 class="hypatia-title">Signing In</h1>

      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>

      <p class="hypatia-subtitle" id="hypatia-signin-status">
        Connecting to your Google account...
      </p>

      <p class="hypatia-hint">
        A Google sign-in popup may appear. Please complete the sign-in to continue.
      </p>
    </div>
  `;
}

function getWelcomeStep() {
  return `
    <div class="hypatia-step hypatia-welcome">
      <div class="hypatia-logo">
        <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" stroke="#4285f4" stroke-width="3" fill="none"/>
          <path d="M20 32 L28 40 L44 24" stroke="#4285f4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>

      <h1 class="hypatia-title">Welcome to Hypatia</h1>

      <p class="hypatia-subtitle">
        Your personal email intelligence assistant
      </p>

      <div class="hypatia-explanation">
        <h3>How Hypatia Works</h3>
        <p>
          Hypatia learns your unique communication style by analyzing your sent emails.
          This helps us understand how you write so we can help you write better emails faster.
        </p>

        <div class="hypatia-features">
          <div class="hypatia-feature">
            <div class="hypatia-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div class="hypatia-feature-text">
              <strong>What we analyze</strong>
              <span>Your 200 most recent sent emails</span>
            </div>
          </div>

          <div class="hypatia-feature">
            <div class="hypatia-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div class="hypatia-feature-text">
              <strong>Your privacy matters</strong>
              <span>Data encrypted, never shared</span>
            </div>
          </div>

          <div class="hypatia-feature">
            <div class="hypatia-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div class="hypatia-feature-text">
              <strong>One-time setup</strong>
              <span>Takes just a moment</span>
            </div>
          </div>
        </div>
      </div>

      <button class="hypatia-btn hypatia-btn-primary" id="hypatia-start-btn">
        Get Started
      </button>

      <p class="hypatia-privacy-note">
        By continuing, you agree to let Hypatia analyze your sent emails.
      </p>
    </div>
  `;
}

function getProgressStep() {
  const percentage = Math.round((progressData.current / progressData.total) * 100);
  const isClustering = progressData.step === 'clustering';

  // If clustering, start the animation
  if (isClustering) {
    startClusteringAnimation();
  }

  return `
    <div class="hypatia-step hypatia-progress">
      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>

      <h2 class="hypatia-title">${isClustering ? 'Grouping Your Emails' : 'Analyzing Your Emails'}</h2>

      <p class="hypatia-subtitle" id="hypatia-status-message">
        ${progressData.message || 'Fetching your sent emails...'}
      </p>

      ${isClustering ? `
        <div class="hypatia-progress-container" id="hypatia-clustering-progress">
          <div class="hypatia-progress-bar">
            <div class="hypatia-progress-fill hypatia-progress-animated" id="hypatia-clustering-fill" style="width: 0%"></div>
          </div>
        </div>
      ` : `
        <div class="hypatia-progress-container" id="hypatia-progress-container">
          <div class="hypatia-progress-bar">
            <div class="hypatia-progress-fill" style="width: ${percentage}%"></div>
          </div>
          <div class="hypatia-progress-text">
            <span id="hypatia-progress-current">${progressData.current}</span>
            <span> / </span>
            <span id="hypatia-progress-total">${progressData.total}</span>
            <span> emails</span>
          </div>
        </div>
        <p class="hypatia-hint">
          Please keep this tab open while we analyze.
        </p>
      `}
    </div>
  `;
}

function startClusteringAnimation() {
  // Clear any existing animation
  if (clusteringAnimationInterval) {
    clearInterval(clusteringAnimationInterval);
  }

  let progress = 0;
  let messageIndex = 0;

  clusteringAnimationInterval = setInterval(() => {
    const fill = document.getElementById('hypatia-clustering-fill');
    const statusMessage = document.getElementById('hypatia-status-message');

    if (!fill) {
      // Element not in DOM, stop animation
      clearInterval(clusteringAnimationInterval);
      clusteringAnimationInterval = null;
      return;
    }

    // Increment progress (slow down as it approaches 90%)
    if (progress < 90) {
      const increment = Math.max(0.5, (90 - progress) / 30);
      progress = Math.min(90, progress + increment);
      fill.style.width = `${progress}%`;
    }

    // Rotate messages every ~2 seconds (interval is ~100ms, so every 20 ticks)
    if (progress > 5 && Math.floor(progress) % 12 === 0) {
      messageIndex = (messageIndex + 1) % CLUSTERING_MESSAGES.length;
      const newMessage = CLUSTERING_MESSAGES[messageIndex];
      if (statusMessage) statusMessage.textContent = newMessage;
    }
  }, 100);
}

function stopClusteringAnimation() {
  if (clusteringAnimationInterval) {
    clearInterval(clusteringAnimationInterval);
    clusteringAnimationInterval = null;
  }

  // Complete the progress bar
  const fill = document.getElementById('hypatia-clustering-fill');
  if (fill) {
    fill.style.width = '100%';
  }
}

function getCompleteStep() {
  const campaignCount = progressData.campaignsCreated || campaignsData.length || 0;

  return `
    <div class="hypatia-step hypatia-complete">
      <div class="hypatia-success-icon">
        <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="38" stroke="#34a853" stroke-width="3" fill="none"/>
          <path d="M24 40 L35 51 L56 30" stroke="#34a853" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>

      <h2 class="hypatia-title">Setup Complete!</h2>

      <p class="hypatia-subtitle">
        Analyzed <strong>${progressData.emailCount || progressData.current}</strong> emails
        ${campaignCount > 0 ? `into <strong>${campaignCount}</strong> categories` : 'successfully'}.
      </p>

      <div class="hypatia-complete-info">
        <p>
          Hypatia has learned your writing style and grouped your emails into categories.
        </p>
      </div>

      ${campaignCount > 0 ? `
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-view-campaigns-btn">
          View Email Categories
        </button>

        <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-done-btn">
          Done
        </button>
      ` : `
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-done-btn">
          Done
        </button>
      `}
    </div>
  `;
}

function getErrorStep() {
  return `
    <div class="hypatia-step hypatia-error">
      <div class="hypatia-error-icon">
        <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="38" stroke="#ea4335" stroke-width="3" fill="none"/>
          <line x1="28" y1="28" x2="52" y2="52" stroke="#ea4335" stroke-width="4" stroke-linecap="round"/>
          <line x1="52" y1="28" x2="28" y2="52" stroke="#ea4335" stroke-width="4" stroke-linecap="round"/>
        </svg>
      </div>

      <h2 class="hypatia-title">Something went wrong</h2>

      <p class="hypatia-subtitle">
        ${progressData.message || 'An error occurred during setup.'}
      </p>

      <button class="hypatia-btn hypatia-btn-primary" id="hypatia-retry-btn">
        Try Again
      </button>

      <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-cancel-btn">
        Cancel
      </button>
    </div>
  `;
}

// =============================================================================
// QUESTIONNAIRE STEPS
// =============================================================================

function getQuestionnaireStep() {
  const question = QUESTIONNAIRE_QUESTIONS[questionnaireState.currentQuestion];
  const isLastQuestion = questionnaireState.currentQuestion === QUESTIONNAIRE_QUESTIONS.length - 1;
  const progress = ((questionnaireState.currentQuestion + 1) / QUESTIONNAIRE_QUESTIONS.length) * 100;

  return `
    <div class="hypatia-step hypatia-questionnaire">
      <div class="hypatia-questionnaire-progress">
        <div class="hypatia-questionnaire-progress-bar">
          <div class="hypatia-questionnaire-progress-fill" style="width: ${progress}%"></div>
        </div>
        <span class="hypatia-questionnaire-progress-text">
          Question ${questionnaireState.currentQuestion + 1} of ${QUESTIONNAIRE_QUESTIONS.length}
        </span>
      </div>

      <h2 class="hypatia-title">${question.title}</h2>

      ${question.hint ? `<p class="hypatia-hint">${question.hint}</p>` : ''}

      <div class="hypatia-question-content">
        ${getQuestionInput(question)}
      </div>

      <div class="hypatia-questionnaire-buttons">
        ${questionnaireState.currentQuestion > 0 ? `
          <button class="hypatia-btn hypatia-btn-secondary" id="hypatia-prev-btn">
            Back
          </button>
        ` : ''}
        <button class="hypatia-btn hypatia-btn-primary" id="hypatia-next-btn">
          ${isLastQuestion ? 'Finish' : 'Next'}
        </button>
      </div>

      ${!question.required ? `
        <button class="hypatia-btn-skip" id="hypatia-skip-btn">
          Skip this question
        </button>
      ` : ''}
    </div>
  `;
}

function getQuestionInput(question) {
  switch (question.type) {
    case 'name_confirm':
      return `
        <div class="hypatia-name-confirm">
          <input
            type="text"
            class="hypatia-input"
            id="hypatia-name-input"
            value="${escapeHtml(questionnaireState.answers.displayName || userDisplayName)}"
            placeholder="Enter your name"
          />
        </div>
      `;

    case 'text':
      const textValue = getAnswerValue(question.id);
      return `
        <textarea
          class="hypatia-textarea"
          id="hypatia-text-input"
          placeholder="${question.placeholder || ''}"
          rows="3"
        >${escapeHtml(textValue)}</textarea>
      `;

    case 'select':
      const selectValue = getAnswerValue(question.id);
      return `
        <div class="hypatia-select-options">
          ${question.options.map(opt => `
            <label class="hypatia-radio-label ${selectValue === opt.value ? 'selected' : ''}">
              <input
                type="radio"
                name="hypatia-select"
                value="${opt.value}"
                ${selectValue === opt.value ? 'checked' : ''}
              />
              <span>${opt.label}</span>
            </label>
          `).join('')}
        </div>
      `;

    default:
      return '';
  }
}

function getAnswerValue(questionId) {
  const mapping = {
    'purpose': 'appPurpose',
    'userType': 'userType',
    'ctas': 'generalCtas',
    'contacts': 'contactTypes',
    'referral': 'referralSource'
  };
  return questionnaireState.answers[mapping[questionId]] || '';
}

function getBackendStatusIndicator() {
  if (backendState.isComplete) {
    return `
      <div class="hypatia-backend-complete">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12 L11 15 L16 10"/>
        </svg>
        <span>Email analysis complete</span>
      </div>
    `;
  }
  return `
    <div class="hypatia-backend-processing">
      <div class="hypatia-mini-spinner"></div>
      <span>Analyzing emails in background...</span>
    </div>
  `;
}

function getWaitingStep() {
  return `
    <div class="hypatia-step hypatia-waiting">
      <div class="hypatia-spinner-container">
        <div class="hypatia-spinner"></div>
      </div>

      <h2 class="hypatia-title">Almost Done!</h2>

      <p class="hypatia-subtitle">
        Thank you for completing the questionnaire. We're finishing up the email analysis...
      </p>

      <div class="hypatia-waiting-animation">
        <div class="hypatia-pulse-dot"></div>
        <div class="hypatia-pulse-dot"></div>
        <div class="hypatia-pulse-dot"></div>
      </div>

      <p class="hypatia-hint">
        This usually takes just a few more seconds.
      </p>
    </div>
  `;
}

// =============================================================================
// QUESTIONNAIRE HANDLERS
// =============================================================================

function handleQuestionnaireNext() {
  const question = QUESTIONNAIRE_QUESTIONS[questionnaireState.currentQuestion];

  // Collect current answer
  if (!collectCurrentAnswer(question)) {
    // Validation failed for required field
    return;
  }

  // Check if last question
  if (questionnaireState.currentQuestion === QUESTIONNAIRE_QUESTIONS.length - 1) {
    handleQuestionnaireComplete();
  } else {
    questionnaireState.currentQuestion++;
    updatePanelContent();
  }
}

function handleQuestionnairePrev() {
  // Save current answer before going back
  const question = QUESTIONNAIRE_QUESTIONS[questionnaireState.currentQuestion];
  collectCurrentAnswer(question);

  if (questionnaireState.currentQuestion > 0) {
    questionnaireState.currentQuestion--;
    updatePanelContent();
  }
}

function handleQuestionnaireSkip() {
  questionnaireState.currentQuestion++;
  updatePanelContent();
}

function collectCurrentAnswer(question) {
  switch (question.type) {
    case 'name_confirm':
      const nameInput = document.getElementById('hypatia-name-input');
      const nameConfirmed = document.getElementById('hypatia-name-confirmed');
      questionnaireState.answers.displayName = nameInput?.value?.trim() || '';
      questionnaireState.answers.nameConfirmed = nameConfirmed?.checked || false;

      if (question.required && !questionnaireState.answers.displayName) {
        showValidationError('Please enter your name');
        return false;
      }
      return true;

    case 'text':
      const textInput = document.getElementById('hypatia-text-input');
      const textValue = textInput?.value?.trim() || '';

      const textMapping = {
        'purpose': 'appPurpose',
        'ctas': 'generalCtas',
        'contacts': 'contactTypes'
      };
      questionnaireState.answers[textMapping[question.id]] = textValue;

      if (question.required && !textValue) {
        showValidationError('This field is required');
        return false;
      }
      return true;

    case 'select':
      const selected = document.querySelector('input[name="hypatia-select"]:checked');
      const selectValue = selected?.value || '';

      const selectMapping = {
        'userType': 'userType',
        'referral': 'referralSource'
      };
      questionnaireState.answers[selectMapping[question.id]] = selectValue;

      if (question.required && !selectValue) {
        showValidationError('Please select an option');
        return false;
      }
      return true;

    default:
      return true;
  }
}

function showValidationError(message) {
  // Remove existing error
  const existingError = document.querySelector('.hypatia-validation-error');
  if (existingError) {
    existingError.remove();
  }

  // Create validation error element
  const errorEl = document.createElement('div');
  errorEl.className = 'hypatia-validation-error';
  errorEl.textContent = message;

  const questionContent = document.querySelector('.hypatia-question-content');
  if (questionContent) {
    questionContent.appendChild(errorEl);
  }

  // Auto-hide after 3 seconds
  setTimeout(() => {
    errorEl?.remove();
  }, 3000);
}

function handleQuestionnaireComplete() {
  questionnaireState.isComplete = true;

  // Track questionnaire completed
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackQuestionnaireCompleted(questionnaireState.answers);
  }

  // Submit answers to background script
  chrome.runtime.sendMessage({
    action: 'submitQuestionnaire',
    userId: currentUserId,
    answers: questionnaireState.answers
  }, (response) => {
    if (!response?.success) {
      console.error('Failed to save questionnaire:', response?.error);
    }
  });

  // Check if both processes are complete
  checkBothProcessesComplete();
}

function checkBothProcessesComplete() {
  if (questionnaireState.isComplete && backendState.isComplete) {
    // Both done - show complete screen
    currentStep = 'complete';
    progressData.emailCount = backendState.emailCount;
    progressData.campaignsCreated = backendState.campaignsCreated;
    campaignsData = backendState.campaigns;

    // Mark onboarding complete
    chrome.runtime.sendMessage({
      action: 'markOnboardingDone',
      userId: currentUserId
    });

    updatePanelContent();
    updateButtonState(true);
  } else if (questionnaireState.isComplete && !backendState.isComplete) {
    // Questionnaire done, waiting for backend
    currentStep = 'waiting';
    updatePanelContent();
  }
  // If backend is complete but questionnaire isn't, user continues questionnaire
}

// =============================================================================
// ONBOARDING EVENT HANDLERS
// =============================================================================

function handleStartOnboarding() {
  console.log('[Hypatia] Starting onboarding...');

  // Track onboarding started
  if (window.HypatiaAnalytics) {
    window.HypatiaAnalytics.trackOnboardingStarted();
    window.HypatiaAnalytics.trackOnboardingAuthStarted();
  }

  currentStep = 'signing_in';
  updatePanelContent();

  // Send message to background to start auth
  chrome.runtime.sendMessage({ action: 'startOnboarding' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Hypatia] Error starting onboarding:', chrome.runtime.lastError);
      currentStep = 'error';
      progressData.message = 'Failed to start authentication. Please try again.';
      updatePanelContent();
    }
  });
}

// handleViewCampaigns and handleDone are defined in content.js

// =============================================================================
// ONBOARDING PROGRESS MESSAGE HANDLER
// =============================================================================

function handleOnboardingProgressUpdate(data) {
  switch (data.step) {
    case 'auth':
      progressData.message = data.message;
      if (data.displayName) {
        userDisplayName = data.displayName;
        // Track auth completed with email
        if (window.HypatiaAnalytics && data.email) {
          window.HypatiaAnalytics.trackOnboardingAuthCompleted(data.email);
        }
      }
      // Update signing in status (new flow) or progress status (legacy)
      const signinStatus = document.getElementById('hypatia-signin-status');
      if (signinStatus) signinStatus.textContent = data.message;
      const statusAuth = document.getElementById('hypatia-status-message');
      if (statusAuth) statusAuth.textContent = data.message;
      break;

    case 'setup':
      progressData.message = data.message;
      // Update signing in status (new flow) or progress status (legacy)
      const signinStatusSetup = document.getElementById('hypatia-signin-status');
      if (signinStatusSetup) signinStatusSetup.textContent = data.message;
      const statusSetup = document.getElementById('hypatia-status-message');
      if (statusSetup) statusSetup.textContent = data.message;
      break;

    case 'questionnaire_start':
      // Backend is starting - switch to questionnaire immediately
      currentUserId = data.userId;
      userDisplayName = data.displayName || '';
      questionnaireState.answers.displayName = userDisplayName;
      questionnaireState.currentQuestion = 0;
      questionnaireState.isComplete = false;
      backendState.isComplete = false;
      currentStep = 'questionnaire';

      // Track questionnaire started and identify user
      if (window.HypatiaAnalytics) {
        window.HypatiaAnalytics.identify(currentUserId, {
          display_name: userDisplayName
        });
        window.HypatiaAnalytics.trackQuestionnaireStarted();
      }

      updatePanelContent();
      break;

    case 'backend_progress':
      // Update backend status indicator without changing step
      const backendStatus = document.getElementById('hypatia-backend-status');
      if (backendStatus) {
        backendStatus.innerHTML = getBackendStatusIndicator();
      }
      break;

    case 'backend_complete':
      // Backend processing finished
      backendState.isComplete = true;
      backendState.emailCount = data.emailCount;
      backendState.campaignsCreated = data.campaignsCreated;
      backendState.campaigns = data.campaigns || [];

      // Update status indicator
      const statusEl = document.getElementById('hypatia-backend-status');
      if (statusEl) {
        statusEl.innerHTML = getBackendStatusIndicator();
      }

      // Check if both processes are complete
      checkBothProcessesComplete();
      break;

    case 'fetching':
      progressData.message = data.message || 'Fetching your sent emails...';
      if (data.current !== undefined) {
        updateProgress(data.current, data.total);
      }
      const statusFetch = document.getElementById('hypatia-status-message');
      if (statusFetch && data.message) statusFetch.textContent = data.message;
      break;

    case 'saving':
      progressData.message = data.message;
      const statusSave = document.getElementById('hypatia-status-message');
      if (statusSave) statusSave.textContent = data.message;
      break;

    case 'clustering':
      progressData.step = 'clustering';
      progressData.message = data.message;
      // Re-render to show clustering UI (hides progress bar, changes title)
      updatePanelContent();
      break;

    case 'complete':
      // Stop the clustering animation before transitioning
      stopClusteringAnimation();
      currentStep = 'complete';
      progressData.emailCount = data.emailCount;
      progressData.campaignsCreated = data.campaignsCreated || 0;
      // Store campaigns data for viewing
      if (data.campaigns && data.campaigns.length > 0) {
        campaignsData = data.campaigns;
      }

      // Track onboarding finished
      if (window.HypatiaAnalytics) {
        window.HypatiaAnalytics.trackOnboardingFinished(
          data.emailCount || 0,
          data.campaignsCreated || 0
        );
      }

      updatePanelContent();
      updateButtonState(true);
      break;

    case 'error':
      currentStep = 'error';
      progressData.message = data.message;
      updatePanelContent();
      break;
  }
}

// =============================================================================
// ONBOARDING EVENT LISTENER ATTACHMENT
// =============================================================================

function attachOnboardingEventListeners() {
  const startBtn = document.getElementById('hypatia-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', handleStartOnboarding);
  }

  const doneBtn = document.getElementById('hypatia-done-btn');
  if (doneBtn) {
    doneBtn.addEventListener('click', handleDone);
  }

  const retryBtn = document.getElementById('hypatia-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', handleStartOnboarding);
  }

  const cancelBtn = document.getElementById('hypatia-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideOnboardingPanel);
  }

  const viewCampaignsBtn = document.getElementById('hypatia-view-campaigns-btn');
  if (viewCampaignsBtn) {
    viewCampaignsBtn.addEventListener('click', handleViewCampaigns);
  }

  // Questionnaire navigation
  const nextBtn = document.getElementById('hypatia-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', handleQuestionnaireNext);
  }

  const prevBtn = document.getElementById('hypatia-prev-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', handleQuestionnairePrev);
  }

  const skipBtn = document.getElementById('hypatia-skip-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', handleQuestionnaireSkip);
  }

  // Radio button selection highlighting
  const radioLabels = document.querySelectorAll('.hypatia-radio-label');
  radioLabels.forEach(label => {
    label.addEventListener('click', () => {
      radioLabels.forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
    });
  });
}
