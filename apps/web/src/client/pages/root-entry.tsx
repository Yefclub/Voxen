import { Navigate, useLocation } from 'react-router-dom';
import { ChatPage } from './chat';

/**
 * Authenticated root (`/`). Always shows chat now (desktop and mobile) — `/`
 * and `/chat` render the same experience. Share-target (`?shared=1`) always
 * redirects to the library so ingest can run.
 */
export function RootEntry(): React.ReactElement {
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  if (params.get('shared') === '1') {
    return <Navigate to={`/transcricoes${location.search}${location.hash}`} replace />;
  }

  return <ChatPage />;
}
