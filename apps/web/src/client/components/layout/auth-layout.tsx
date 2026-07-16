import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';

export function AuthLayout(): React.ReactElement {
  const { data, loading } = useMe();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  if (data?.user && data.user.status === 'APPROVED') {
    // Admin sem onboarding completo → manda pro wizard
    if (!data.onboardingDone && data.user.role === 'ADMIN') {
      return <Navigate to="/onboarding" replace />;
    }
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
