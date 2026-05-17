import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';

export function AppLayout(): React.ReactElement {
  const { data, loading } = useMe();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-6 w-6 text-zinc-400" />
      </div>
    );
  }

  if (!data?.user) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  if (data.user.status !== 'APPROVED') {
    return <Navigate to="/pendente" replace />;
  }

  // Admin com setup incompleto → força ir pra /setup
  if (!data.setupComplete && data.user.role === 'ADMIN' && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  // User comum com setup incompleto → tela de aviso (não pode fazer nada útil)
  if (!data.setupComplete && data.user.role !== 'ADMIN') {
    return <Navigate to="/pendente" replace />;
  }

  return (
    <div className="min-h-screen flex bg-zinc-950">
      <Sidebar user={data.user} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={data.user} />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
