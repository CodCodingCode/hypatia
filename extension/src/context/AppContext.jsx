import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { signal, computed } from '@preact/signals';

// =============================================================================
// GLOBAL STATE SIGNALS
// =============================================================================

// User state
export const userId = signal(null);
export const userEmail = signal(null);
export const userDisplayName = signal(null);
export const isAuthenticated = computed(() => !!userId.value);

// UI state
export const currentScreen = signal('welcome');
export const isLoading = signal(false);
export const error = signal(null);

// Sidebar state
export const sidebarOpen = signal(true);

// Load sidebar state from storage
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['hypatia_sidebar_open'], (result) => {
    if (result.hypatia_sidebar_open !== undefined) {
      sidebarOpen.value = result.hypatia_sidebar_open;
    }
  });
}

// Chat state
export const chatMessages = signal([]);
export const chatInput = signal('');

// Campaigns state
export const campaigns = signal([]);
export const selectedCampaignId = signal(null);
export const selectedCampaign = computed(() => {
  if (!selectedCampaignId.value) return null;
  return campaigns.value.find(c => c.id === selectedCampaignId.value) || null;
});
export const campaignsPage = signal(1);
export const campaignsPerPage = signal(6);

// Leads state
export const currentLeads = signal([]);
export const selectedLeadIds = signal(new Set());

// Template state
export const currentTemplate = signal({ subject: '', body: '' });
export const originalTemplate = signal({ subject: '', body: '' });
export const hasTemplateChanges = computed(() => {
  const current = currentTemplate.value;
  const original = originalTemplate.value;
  return current.subject !== original.subject || current.body !== original.body;
});

// Parallel generation state
export const generationState = signal({
  isGenerating: false,
  leadsLoading: false,
  templateLoading: false,
  cadenceLoading: false,
  leadsResult: null,
  templateResult: null,
  cadenceResult: null,
  leadsError: null,
  templateError: null,
  cadenceError: null
});

// Cadence timing
export const cadenceTiming = signal({
  day_1: 1,
  day_2: 3,
  day_3: 7,
  day_4: 14
});

// Chat generation results (displayed at top of sidebar after submission)
export const chatGenerationResults = signal({
  isVisible: false,
  isExpanded: false,
  leadsLoading: false,
  leadsResult: null,      // { leads: [], count: number }
  leadsError: null,
  templateLoading: false,
  templateResult: null,   // { subject, body, placeholders }
  templateError: null,
  query: null,
  campaignId: null,       // Quick Generation campaign ID
});

// =============================================================================
// STATE ACTIONS
// =============================================================================

export const actions = {
  // User actions
  setUser(id, email, displayName) {
    userId.value = id;
    userEmail.value = email;
    userDisplayName.value = displayName;
  },

  clearUser() {
    userId.value = null;
    userEmail.value = null;
    userDisplayName.value = null;
  },

  // Campaign actions
  setCampaigns(data) {
    campaigns.value = data;
  },

  selectCampaign(id) {
    selectedCampaignId.value = id;
  },

  updateCampaign(id, updates) {
    campaigns.value = campaigns.value.map(c =>
      c.id === id ? { ...c, ...updates } : c
    );
  },

  // Leads actions
  setLeads(data) {
    currentLeads.value = data;
    selectedLeadIds.value = new Set();
  },

  addLead(lead) {
    currentLeads.value = [...currentLeads.value, lead];
  },

  removeLead(leadId) {
    currentLeads.value = currentLeads.value.filter(l => l.id !== leadId);
    selectedLeadIds.value = new Set(
      [...selectedLeadIds.value].filter(id => id !== leadId)
    );
  },

  toggleLeadSelection(leadId) {
    const newSelection = new Set(selectedLeadIds.value);
    if (newSelection.has(leadId)) {
      newSelection.delete(leadId);
    } else {
      newSelection.add(leadId);
    }
    selectedLeadIds.value = newSelection;
  },

  selectAllLeads() {
    selectedLeadIds.value = new Set(currentLeads.value.map(l => l.id));
  },

  deselectAllLeads() {
    selectedLeadIds.value = new Set();
  },

  // Template actions
  setTemplate(template) {
    currentTemplate.value = template;
    originalTemplate.value = { ...template };
  },

  updateTemplate(updates) {
    currentTemplate.value = { ...currentTemplate.value, ...updates };
  },

  resetTemplate() {
    currentTemplate.value = { ...originalTemplate.value };
  },

  // Generation actions
  startGeneration(type) {
    generationState.value = {
      ...generationState.value,
      isGenerating: true,
      [`${type}Loading`]: true,
      [`${type}Result`]: null,
      [`${type}Error`]: null
    };
  },

  completeGeneration(type, result) {
    generationState.value = {
      ...generationState.value,
      [`${type}Loading`]: false,
      [`${type}Result`]: result
    };

    // Check if all generations are complete
    const state = generationState.value;
    if (!state.leadsLoading && !state.templateLoading && !state.cadenceLoading) {
      generationState.value = { ...state, isGenerating: false };
    }
  },

  failGeneration(type, error) {
    generationState.value = {
      ...generationState.value,
      [`${type}Loading`]: false,
      [`${type}Error`]: error
    };

    const state = generationState.value;
    if (!state.leadsLoading && !state.templateLoading && !state.cadenceLoading) {
      generationState.value = { ...state, isGenerating: false };
    }
  },

  resetGeneration() {
    generationState.value = {
      isGenerating: false,
      leadsLoading: false,
      templateLoading: false,
      cadenceLoading: false,
      leadsResult: null,
      templateResult: null,
      cadenceResult: null,
      leadsError: null,
      templateError: null,
      cadenceError: null
    };
  },

  // Screen navigation
  setScreen(screen) {
    currentScreen.value = screen;
  },

  // Error handling
  setError(err) {
    error.value = err;
  },

  clearError() {
    error.value = null;
  },

  // Loading state
  setLoading(loading) {
    isLoading.value = loading;
  },

  // Sidebar actions
  openSidebar() {
    sidebarOpen.value = true;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ hypatia_sidebar_open: true });
    }
  },

  closeSidebar() {
    sidebarOpen.value = false;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ hypatia_sidebar_open: false });
    }
  },

  toggleSidebar() {
    if (sidebarOpen.value) {
      actions.closeSidebar();
    } else {
      actions.openSidebar();
    }
  },

  // Chat actions
  addChatMessage(message) {
    chatMessages.value = [...chatMessages.value, message];
  },

  setChatInput(value) {
    chatInput.value = value;
  },

  clearChat() {
    chatMessages.value = [];
    chatInput.value = '';
  },

  // Chat generation results actions
  showChatGenerationResults(query, { generateLeads, generateTemplate }) {
    chatGenerationResults.value = {
      isVisible: true,
      isExpanded: false,
      leadsLoading: generateLeads,
      leadsResult: null,
      leadsError: null,
      templateLoading: generateTemplate,
      templateResult: null,
      templateError: null,
      query,
      campaignId: chatGenerationResults.value.campaignId,
    };
  },

  setChatLeadsResult(result, error = null) {
    chatGenerationResults.value = {
      ...chatGenerationResults.value,
      leadsLoading: false,
      leadsResult: result,
      leadsError: error,
    };
  },

  setChatTemplateResult(result, error = null) {
    chatGenerationResults.value = {
      ...chatGenerationResults.value,
      templateLoading: false,
      templateResult: result,
      templateError: error,
    };
  },

  setChatGenerationCampaignId(campaignId) {
    chatGenerationResults.value = {
      ...chatGenerationResults.value,
      campaignId,
    };
  },

  toggleChatResultsExpanded() {
    chatGenerationResults.value = {
      ...chatGenerationResults.value,
      isExpanded: !chatGenerationResults.value.isExpanded,
    };
  },

  hideChatGenerationResults() {
    chatGenerationResults.value = {
      ...chatGenerationResults.value,
      isVisible: false,
    };
  },
};

// =============================================================================
// CONTEXT PROVIDER
// =============================================================================

const AppContext = createContext(null);

export function AppProvider({ children }) {
  return (
    <AppContext.Provider value={{ actions }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

// =============================================================================
// CHROME MESSAGE HELPERS
// =============================================================================

export async function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// Helper to get userId from storage
async function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['userId'], (data) => {
      resolve(data.userId);
    });
  });
}

// Pre-configured message functions
export const api = {
  async getUser() {
    const response = await sendMessage('checkOnboardingStatus');
    return response;
  },

  async fetchCampaigns() {
    const userId = await getUserId();
    const response = await sendMessage('getCampaigns', { userId });
    return response.campaigns || [];
  },

  async fetchCampaignLeads(campaignId) {
    const userId = await getUserId();
    const response = await sendMessage('getSavedLeads', { userId, campaignId });
    return response.leads || [];
  },

  async saveLead(campaignId, lead) {
    const userId = await getUserId();
    return await sendMessage('saveLead', { userId, campaignId, lead });
  },

  async generateLeads(campaignId, query, limit) {
    const userId = await getUserId();
    return await sendMessage('generateLeads', { userId, campaignId, query, limit });
  },

  async generateTemplate(campaignId) {
    const userId = await getUserId();
    return await sendMessage('generateTemplate', { userId, campaignId });
  },

  async saveTemplate(campaignId, template) {
    const userId = await getUserId();
    return await sendMessage('saveTemplate', { userId, campaignId, template });
  },

  async sendEmails(campaignId, leadIds, template) {
    const userId = await getUserId();
    return await sendMessage('sendEmailBatch', { userId, campaignId, emails: leadIds.map(id => ({ leadId: id, ...template })) });
  },

  async fetchSentEmails(campaignId) {
    const userId = await getUserId();
    const response = await sendMessage('getAllSentEmails', { userId });
    return response.sentEmails || [];
  },

  async getOrCreateQuickCampaign() {
    const userId = await getUserId();
    // First try to find existing Quick Generation campaign
    const response = await sendMessage('getCampaigns', { userId });
    const existingCampaigns = response.campaigns || [];
    const quickCampaign = existingCampaigns.find(c => c.name === 'Quick Generation');

    if (quickCampaign) {
      return quickCampaign;
    }

    // Create a new Quick Generation campaign
    const createResponse = await sendMessage('createCampaign', {
      userId,
      name: 'Quick Generation',
      description: 'Auto-generated campaign for quick chat generations'
    });
    return createResponse.campaign;
  },

  async generateTemplateWithCta(campaignId, cta, stylePrompt = '') {
    const userId = await getUserId();
    return await sendMessage('generateTemplate', {
      userId,
      campaignId,
      cta,
      stylePrompt
    });
  }
};
