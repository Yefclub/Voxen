import { useEffect, useRef } from 'react';
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
  const mainRef = useRef<HTMLElement>(null);
  // Watcher global de jobs do user logado (toast em qualquer página)
  useJobsWatcher(!!(data?.user && data.user.status === 'APPROVED' && data.onboardingDone), (path) =>
    navigate(path),
  );

  // O scroll migrou da window para o <main> (shell de altura fixa com header
  // travado). Resetar ao topo a cada troca de rota pra não herdar a posição da
  // página anterior.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  if (!data?.user) {
    return (
      <Navigate to="/entrar" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
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

  // App shell de altura fixa: o cabeçalho (Topbar) fica travado no topo e o
  // conteúdo rola dentro do <main>. /chat continua gerenciando a própria altura
  // (input fixo no fundo), então não recebe o overflow-y-auto.
  const isChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const mainClass = isChat ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-y-auto pb-6';

  return (
    <ChatContextProvider>
      <div className="flex h-dvh overflow-hidden bg-[var(--color-app-bg)]">
        <Sidebar user={data.user} />
        <SidebarSpacer />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar user={data.user} />
          <main ref={mainRef} className={mainClass}>
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
