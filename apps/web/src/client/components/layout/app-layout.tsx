import { useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  Navigate,
  UNSAFE_LocationContext as LocationContext,
  UNSAFE_RouteContext as RouteContext,
  useLocation,
  useNavigate,
  useOutlet,
} from 'react-router-dom';
import { AnimatePresence, usePresence } from 'motion/react';
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
  const sectionRef = useRef(getSectionKey(location.pathname));
  // Watcher global de jobs do user logado (toast em qualquer página)
  useJobsWatcher(!!(data?.user && data.user.status === 'APPROVED' && data.onboardingDone), (path) =>
    navigate(path),
  );

  const resetScroll = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  // O scroll vive no <main> (shell de altura fixa). Navegar DENTRO da mesma
  // seção não dispara a transição (mesma key), então o reset é imediato aqui;
  // trocas de seção resetam no onExitComplete (depois do fade-out) pra não
  // "pular" o conteúdo que está saindo.
  useEffect(() => {
    const key = getSectionKey(location.pathname);
    if (key === sectionRef.current) resetScroll();
    sectionRef.current = key;
  }, [location.pathname, resetScroll]);

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
  // conteúdo rola dentro do <main>. /chat e /grafo ocupam a tela toda e
  // gerenciam a própria altura, então não recebem o overflow-y-auto/padding.
  const isChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const isGraph = location.pathname === '/grafo' || location.pathname.startsWith('/grafo/');
  const isFullBleed = isChat || isGraph;
  const mainClass = isFullBleed ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-y-auto pb-6';

  return (
    <ChatContextProvider>
      <div className="flex h-dvh overflow-hidden bg-[var(--color-app-bg)]">
        <Sidebar user={data.user} />
        <SidebarSpacer />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar user={data.user} />
          <main ref={mainRef} className={mainClass}>
            <AnimatedOutlet onExitComplete={resetScroll} />
          </main>
          {!isFullBleed && <VersionFooter />}
        </div>
      </div>
    </ChatContextProvider>
  );
}

/**
 * Agrupa rotas por seção pra animar a troca ENTRE seções sem remontar ao
 * navegar dentro da mesma seção (ex.: /chat/a→/chat/b, /notas/x→/notas/y,
 * /jobs/1→/jobs/2 preservam estado e scroll).
 */
function getSectionKey(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0] ?? 'dashboard';
  // /admin/usuarios, /admin/custos e /admin/integracoes são seções distintas.
  return root === 'admin' ? `admin/${segments[1] ?? ''}` : root;
}

/**
 * Mantém LocationContext/RouteContext estáveis para a página que está saindo.
 * Enquanto a instância está presente, acompanha o router atual — navegar dentro
 * da mesma seção (ex.: /notas/a→/notas/b, trocar de conversa em /chat) atualiza
 * os params normalmente. Quando a instância começa a sair (isPresent=false),
 * congela o último router pra página não renderizar com useParams() vazio
 * durante o fade-out.
 */
function FrozenRouter({ children }: { children: ReactNode }): React.ReactElement {
  const [isPresent] = usePresence();
  const location = useContext(LocationContext);
  const route = useContext(RouteContext);
  const frozenLocation = useRef(location);
  const frozenRoute = useRef(route);
  if (isPresent) {
    frozenLocation.current = location;
    frozenRoute.current = route;
  }
  return (
    <LocationContext.Provider value={frozenLocation.current}>
      <RouteContext.Provider value={frozenRoute.current}>{children}</RouteContext.Provider>
    </LocationContext.Provider>
  );
}

/**
 * Conteúdo da rota com transição de saída + entrada entre seções. As páginas
 * animam via <AnimatedPage> (que respeita prefers-reduced-motion); /chat não
 * usa AnimatedPage, então troca sem animação de propósito.
 */
function AnimatedOutlet({ onExitComplete }: { onExitComplete: () => void }): React.ReactElement {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence mode="wait" initial={false} onExitComplete={onExitComplete}>
      <div key={getSectionKey(location.pathname)} className="contents">
        <FrozenRouter>{outlet}</FrozenRouter>
      </div>
    </AnimatePresence>
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
