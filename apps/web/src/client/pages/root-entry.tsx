import { Navigate, useLocation } from 'react-router-dom';
import { useIsDesktop } from '../lib/use-media-query';
import { ChatPage } from './chat';
import { HomePage } from './home';

/**
 * Authenticated root (`/`). Desktop shows chat; mobile shows the slim home.
 * Share-target (`?shared=1`) always redirects to the library so ingest can run.
 */
export function RootEntry(): React.ReactElement {
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const params = new URLSearchParams(location.search);

  if (params.get('shared') === '1') {
    return <Navigate to={`/transcricoes${location.search}${location.hash}`} replace />;
  }

  if (isDesktop) return <ChatPage />;
  return <HomePage />;
}
