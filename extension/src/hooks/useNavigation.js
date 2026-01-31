import { signal, computed } from '@preact/signals';

// Route constants
export const ROUTES = {
  HOME: 'hypatia',
  CAMPAIGN: 'hypatia/campaign',
  LEADS: 'hypatia/leads',
  TEMPLATES: 'hypatia/templates',
  SENT: 'hypatia/sent',
  DASHBOARD: 'hypatia/dashboard'
};

// Navigation state
export const currentHash = signal(window.location.hash.slice(1) || '');
export const previousHash = signal('');

// Computed route info
export const currentRoute = computed(() => {
  const hash = currentHash.value;

  if (!hash || !hash.startsWith('hypatia')) {
    return { name: 'gmail', params: {} };
  }

  if (hash === 'hypatia') {
    return { name: 'campaigns', params: {} };
  }

  if (hash.startsWith('hypatia/campaign/')) {
    const campaignId = hash.replace('hypatia/campaign/', '');
    return { name: 'campaign-detail', params: { campaignId } };
  }

  if (hash === 'hypatia/leads') {
    return { name: 'leads', params: {} };
  }

  if (hash === 'hypatia/templates') {
    return { name: 'templates', params: {} };
  }

  if (hash === 'hypatia/sent') {
    return { name: 'sent', params: {} };
  }

  if (hash === 'hypatia/dashboard') {
    return { name: 'dashboard', params: {} };
  }

  return { name: 'campaigns', params: {} };
});

export const isHypatiaRoute = computed(() => {
  return currentHash.value.startsWith('hypatia');
});

/**
 * Navigate to a Hypatia route
 */
export function navigate(route, params = {}) {
  previousHash.value = currentHash.value;

  let newHash = route;

  // Handle parameterized routes
  if (route === ROUTES.CAMPAIGN && params.campaignId) {
    newHash = `${route}/${params.campaignId}`;
  }

  window.location.hash = newHash;
}

/**
 * Navigate back to previous location (or Gmail inbox)
 */
export function navigateBack() {
  const prev = previousHash.value;

  if (prev && !prev.startsWith('hypatia')) {
    // Go back to Gmail location
    window.location.hash = prev;
  } else if (currentRoute.value.name === 'campaign-detail') {
    // From campaign detail, go to campaigns list
    navigate(ROUTES.HOME);
  } else if (
    currentRoute.value.name === 'leads' ||
    currentRoute.value.name === 'templates' ||
    currentRoute.value.name === 'sent'
  ) {
    // From sub-pages, go to campaigns list
    navigate(ROUTES.HOME);
  } else {
    // Default: close Hypatia (go to inbox)
    window.location.hash = 'inbox';
  }
}

/**
 * Close Hypatia panel and return to Gmail
 */
export function closeHypatia() {
  const prev = previousHash.value;
  if (prev && !prev.startsWith('hypatia')) {
    window.location.hash = prev;
  } else {
    window.location.hash = 'inbox';
  }
}

/**
 * Initialize navigation listener
 */
export function initNavigation() {
  const handleHashChange = () => {
    const newHash = window.location.hash.slice(1);

    // Store previous hash before updating
    if (!newHash.startsWith('hypatia') && currentHash.value.startsWith('hypatia')) {
      // Leaving Hypatia
      previousHash.value = '';
    } else if (newHash.startsWith('hypatia') && !currentHash.value.startsWith('hypatia')) {
      // Entering Hypatia
      previousHash.value = currentHash.value;
    }

    currentHash.value = newHash;
  };

  window.addEventListener('hashchange', handleHashChange);

  // Initial hash
  currentHash.value = window.location.hash.slice(1) || '';

  return () => window.removeEventListener('hashchange', handleHashChange);
}

/**
 * Hook for components to access navigation
 */
export function useNavigation() {
  return {
    currentRoute,
    currentHash,
    previousHash,
    isHypatiaRoute,
    navigate,
    navigateBack,
    closeHypatia
  };
}
