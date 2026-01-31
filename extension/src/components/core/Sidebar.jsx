import { useEffect, useState, useRef } from 'preact/hooks';
import { sidebarOpen, actions } from '../../context/AppContext';
import { gmailTheme } from '../../hooks/useGmailTheme';
import { SidebarHeader } from './SidebarHeader';
import { GenerationResults } from './GenerationResults';
import { ChatInterface } from './ChatInterface';

const SIDEBAR_WIDTH = 360;
const ANIMATION_DURATION = 250; // ms - matches CSS transition
const TRANSITION_STYLE = `width ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), max-width ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), padding-right ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;

/**
 * Apply transition styles to Gmail elements for smooth animation
 */
function applyTransitionToElement(el) {
  if (el && !el.dataset.hypatiaTransition) {
    el.style.transition = TRANSITION_STYLE;
    el.dataset.hypatiaTransition = 'true';
  }
}

/**
 * Apply width constraint to Gmail's main content area
 */
function applyGmailShrink(shrink) {
  console.log(`[Hypatia] applyGmailShrink called with shrink=${shrink}`);

  // Gmail uses a complex nested flexbox layout. We need to constrain the width
  // of the outermost content wrapper, not just add margins.
  // The key element is the one that contains the entire right side of Gmail
  // (everything except the left navigation).

  // Try multiple approaches to find the right container

  // Approach 1: Target the main Gmail app container and constrain its width
  // Gmail's structure: .aeN (left nav) + .bkK (main content)
  // We want to shrink .bkK

  const mainContent = document.querySelector('.nH.bkK') || document.querySelector('.bkK');

  if (mainContent) {
    applyTransitionToElement(mainContent);
    const rect = mainContent.getBoundingClientRect();
    console.log('[Hypatia] Main content (.bkK):', {
      currentWidth: rect.width,
      left: rect.left,
      targetWidth: shrink ? `calc(100% - ${SIDEBAR_WIDTH}px)` : '',
    });

    if (shrink) {
      // Use width constraint instead of margin
      mainContent.style.width = `calc(100% - ${SIDEBAR_WIDTH}px)`;
      mainContent.style.maxWidth = `calc(100% - ${SIDEBAR_WIDTH}px)`;
      mainContent.style.marginRight = '0';
    } else {
      mainContent.style.width = '';
      mainContent.style.maxWidth = '';
      mainContent.style.marginRight = '';
    }
  }

  // Approach 2: Also try constraining the parent flex container
  // Look for Gmail's top-level layout container
  const topContainer = document.querySelector('.aeN')?.parentElement;
  if (topContainer) {
    applyTransitionToElement(topContainer);
    console.log('[Hypatia] Top container (parent of .aeN):', {
      classes: topContainer.className,
      width: topContainer.getBoundingClientRect().width,
    });

    if (shrink) {
      topContainer.style.paddingRight = `${SIDEBAR_WIDTH}px`;
    } else {
      topContainer.style.paddingRight = '';
    }
  }

  // Approach 3: Target the top header bar container (gb_Kd gb_Nd gb_Zd)
  // This is Gmail's top bar that also needs to shrink
  const headerBar = document.querySelector('.gb_Kd.gb_Nd.gb_Zd') || document.querySelector('.gb_Kd');
  if (headerBar) {
    applyTransitionToElement(headerBar);
    console.log('[Hypatia] Header bar (.gb_Kd):', {
      classes: headerBar.className,
      width: headerBar.getBoundingClientRect().width,
    });

    if (shrink) {
      headerBar.style.width = `calc(100% - ${SIDEBAR_WIDTH}px)`;
      headerBar.style.maxWidth = `calc(100% - ${SIDEBAR_WIDTH}px)`;
    } else {
      headerBar.style.width = '';
      headerBar.style.maxWidth = '';
    }
  }

  // Log the results
  setTimeout(() => {
    const bkK = document.querySelector('.bkK');
    const aeJ = document.querySelector('.aeJ');
    const gbKd = document.querySelector('.gb_Kd');
    console.log('[Hypatia] After apply:', {
      bkK: bkK ? { width: bkK.getBoundingClientRect().width, classes: bkK.className } : null,
      aeJ: aeJ ? { width: aeJ.getBoundingClientRect().width, classes: aeJ.className } : null,
      gbKd: gbKd ? { width: gbKd.getBoundingClientRect().width, classes: gbKd.className } : null,
    });
  }, 100);
}

/**
 * Persistent right-side sidebar panel
 * Positioned at the far right, Gmail content shrinks to accommodate
 */
export function Sidebar() {
  const [animationState, setAnimationState] = useState('closed'); // 'closed' | 'entering' | 'entered' | 'exiting'
  const timeoutRef = useRef(null);

  // Handle open/close with animation
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (sidebarOpen.value) {
      // Opening: start with entering state, then transition to entered
      setAnimationState('entering');
      // Use requestAnimationFrame to ensure the entering class is applied before transitioning
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimationState('entered');
          // Apply Gmail shrink at the same time as sidebar slides in
          applyGmailShrink(true);
        });
      });
    } else {
      // Closing: start exit animation and Gmail expand simultaneously
      if (animationState === 'entered' || animationState === 'entering') {
        setAnimationState('exiting');
        // Start Gmail expand animation immediately so it animates with sidebar
        applyGmailShrink(false);
        timeoutRef.current = setTimeout(() => {
          setAnimationState('closed');
        }, ANIMATION_DURATION);
      }
    }

    // Watch for Gmail DOM changes and reapply
    const observer = new MutationObserver(() => {
      if (sidebarOpen.value && animationState === 'entered') {
        applyGmailShrink(true);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      observer.disconnect();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [sidebarOpen.value]);

  // Don't render anything when fully closed
  if (animationState === 'closed') {
    return null;
  }

  const sidebarClass = `hypatia-sidebar hypatia-sidebar--${animationState}`;

  return (
    <div
      class={sidebarClass}
      data-hypatia-theme={gmailTheme.value}
    >
      <SidebarHeader onClose={actions.closeSidebar} />
      <GenerationResults />
      <div class="hypatia-sidebar__body">
        <ChatInterface />
      </div>
    </div>
  );
}

/**
 * Edge slider tab to reopen sidebar when closed
 */
export function SliderTab() {
  // Only show when sidebar is closed
  if (sidebarOpen.value) {
    return null;
  }

  return (
    <button
      class="hypatia-slider-tab"
      onClick={actions.openSidebar}
      title="Open Hypatia"
      data-hypatia-theme={gmailTheme.value}
    >
      <div class="hypatia-slider-tab__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </div>
      <span class="hypatia-slider-tab__label">Hypatia</span>
    </button>
  );
}
