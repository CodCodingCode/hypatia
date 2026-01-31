import { useNavigation } from '../../hooks/useNavigation';
import { CampaignsList } from '../screens/CampaignsList';
import { CampaignDetail } from '../screens/CampaignDetail';
import { LeadsScreen } from '../screens/LeadsScreen';
import { TemplateEditor } from '../screens/TemplateEditor';
import { SentEmails } from '../screens/SentEmails';
import { GeneratingScreen } from '../screens/GeneratingScreen';
import { generationState } from '../../context/AppContext';

/**
 * Router component - renders the correct screen based on current route
 */
export function Router() {
  const { currentRoute } = useNavigation();

  // Show generating screen if generation is in progress
  if (generationState.value.isGenerating) {
    return <GeneratingScreen />;
  }

  const route = currentRoute.value;

  switch (route.name) {
    case 'campaigns':
      return <CampaignsList />;

    case 'campaign-detail':
      return <CampaignDetail campaignId={route.params.campaignId} />;

    case 'leads':
      return <LeadsScreen />;

    case 'templates':
      return <TemplateEditor />;

    case 'sent':
      return <SentEmails />;

    case 'dashboard':
      return <CampaignsList />; // Fallback for now

    default:
      return <CampaignsList />;
  }
}
