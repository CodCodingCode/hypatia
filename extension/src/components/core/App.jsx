import { useEffect } from 'preact/hooks';
import { AppProvider } from '../../context/AppContext';
import { initThemeDetection, gmailTheme } from '../../hooks/useGmailTheme';
import { Sidebar, SliderTab } from './Sidebar';

/**
 * Root App component - renders persistent sidebar
 */
export function App() {
  // Initialize theme detection on mount
  useEffect(() => {
    const cleanupTheme = initThemeDetection();
    return () => cleanupTheme();
  }, []);

  // Apply theme to root container
  useEffect(() => {
    const root = document.getElementById('hypatia-sidebar-root');
    if (root) {
      root.setAttribute('data-hypatia-theme', gmailTheme.value);
    }
  }, [gmailTheme.value]);

  return (
    <AppProvider>
      <Sidebar />
      <SliderTab />
    </AppProvider>
  );
}
