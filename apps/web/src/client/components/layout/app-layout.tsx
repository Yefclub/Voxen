import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, SidebarSpacer } from './sidebar';
import { Topbar } from './topbar';
import { useMe, useFetch } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';
import { useJobsWatcher } from '../../lib/use-jobs-watcher';
import { ChatContextProvider } from '../../lib/chat-context-ctx';

export function AppLayout(): React.ReactElement {
  const { data, loading } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  // Watcher global de jobs do user logado (toast em qualquer página)
  useJobsWatcher(!!(data?.user && data.user.status === 'APPROVED' && data.onboardingDone), (path) =>
    navigate(path),
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  if (!data?.user) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  if (data.user.status !== 'APPROVED') {
    return <Navigate to="/pendente" replace />;
  }

  // Admin sem onboarding completo → wizard de onboarding (que já cobre setup)
  if (!data.onboardingDone && data.user.role === 'ADMIN' && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  // Admin com onboarding feito mas tentando reentrar → manda pro painel
  if (data.onboardingDone && location.pathname === '/onboarding') {
    return <Navigate to="/dashboard" replace />;
  }
  // User comum sem onboarding feito → tela de espera (admin precisa terminar)
  if (!data.onboardingDone && data.user.role !== 'ADMIN') {
    return <Navigate to="/pendente" replace />;
  }

  // Em /chat o conteúdo gerencia a própria altura (input fixo no fundo), então
  // removemos o padding bottom do <main> pra não criar scroll extra na página.
  const isChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/');

  return (
    <ChatContextProvider>
      <div className="h-dvh flex bg-[var(--color-app-bg)] overflow-hidden">
        <Sidebar user={data.user} />
        <SidebarSpacer />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Topbar user={data.user} />
          <main
            className={
              isChat ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-y-auto overscroll-contain pb-6'
            }
          >
            <Outlet />
          </main>
          {!isChat && <VersionFooter />}
        </div>
      </div>
    </ChatContextProvider>
  );
}

function VersionFooter(): React.ReactElement | null {
  const { data } = useFetch<{ version: string; gitSha: string | null; builtAt: string }>(
    '/api/version',
  );
  if (!data?.version) return null;
  return (
    <footer className="pointer-events-none fixed bottom-2 right-3 z-10 text-[10px] uppercase tracking-[0.12em] text-[var(--color-app-muted)]/60 font-mono select-none">
      Voxen v{data.version}
      {data.gitSha && <span className="ml-1.5 opacity-70">·{data.gitSha.slice(0, 7)}</span>}
    </footer>
  );
}
