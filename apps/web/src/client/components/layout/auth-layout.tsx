import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { mcpOAuthSsoCallback, pendingOAuthQuery } from '../../lib/mcp-oauth-login';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';
import { SessionUnavailable } from '../session-unavailable';

export function AuthLayout(): React.ReactElement {
  const { data, loading, error, refresh } = useMe();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  if (error && !data) return <SessionUnavailable onRetry={refresh} />;

  if (data?.user && data.user.status === 'APPROVED') {
    // Admin sem onboarding completo → manda pro wizard
    if (!data.onboardingDone && data.user.role === 'ADMIN') {
      return <Navigate to="/onboarding" replace />;
    }
    // Already signed in while an MCP client waits for authorization: resume it
    // on the server instead of dropping the flow on the library.
    const resume = location.pathname === '/entrar' ? pendingOAuthQuery(location.search) : undefined;
    if (resume) return <ResumeAuthorization query={resume} />;
    return <Navigate to="/" replace />;
  }

  // /entrar e /cadastro são telas full-screen fora da app shell. Como o body
  // fica travado pra evitar scroll duplicado na aplicação, elas rolam aqui.
  return (
    <div className="h-dvh overflow-y-auto overscroll-contain">
      <Outlet key={location.pathname} />
    </div>
  );
}

function ResumeAuthorization({ query }: { query: string }): React.ReactElement {
  useEffect(() => {
    const target = mcpOAuthSsoCallback(query);
    if (target) window.location.replace(target);
  }, [query]);
  return (
    <div className="min-h-dvh flex items-center justify-center">
      <Spinner size={20} className="text-[var(--color-app-muted)]" />
    </div>
  );
}
