import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { Sidebar, SidebarSpacer } from './sidebar';
import { MobileNavDrawer } from './mobile-nav-drawer';
import { MobileBottomNav } from './mobile-bottom-nav';
import { Topbar } from './topbar';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';
import { useJobsWatcher } from '../../lib/use-jobs-watcher';
import { useVersionMonitor } from '../../lib/use-version-monitor';
import { UpdateModal } from '../update-modal';
import { useIsDesktop } from '../../lib/use-media-query';
import { useEdgeSwipe } from '../../lib/use-edge-swipe';
import {
  showsMobileBack,
  hasOwnMobileChrome,
  isChatRoute,
  hidesBottomNav,
} from '../../lib/mobile-nav';
import { MobileBackButton } from './mobile-back-button';
import { MobileMenuButton } from './mobile-menu-button';
import { SessionUnavailable } from '../session-unavailable';

export function AppLayout(): React.ReactElement {
  const { data, loading, error, refresh } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  // Navegação mobile (<md): o Topbar flutuante não hospeda navegação — quem
  // faz isso é a bottom-nav (abas + menu do Perfil com os destinos únicos) +
  // botão de voltar flutuante + swipe da borda pra abrir o drawer (bônus).
  // Estado do drawer vive aqui pra ligar o edge-swipe e o botão de abrir menu
  // (rota de chat, onde a bottom-nav some) ao overlay.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isDesktop = useIsDesktop();
  // Swipe da borda esquerda → direita abre o drawer; swipe de volta fecha. Só
  // ativo no mobile (no desktop a navegação é a sidebar). Hooks sempre rodam
  // (regras de hooks) — `enabled` controla o anexo dos listeners.
  useEdgeSwipe({
    enabled: !isDesktop,
    isOpen: mobileNavOpen,
    onOpen: () => setMobileNavOpen(true),
    onClose: () => setMobileNavOpen(false),
  });
  // Watcher global de jobs do user logado (toast em qualquer página)
  useJobsWatcher(!!(data?.user && data.user.status === 'APPROVED' && data.onboardingDone), (path) =>
    navigate(path),
  );
  // Aviso de versão nova do backend — modal centralizado com o que mudou.
  const versionMonitor = useVersionMonitor(!!data?.user);

  // O scroll vive no <main> (shell de altura fixa). Resetar ao topo a cada troca
  // de rota pra não herdar a posição da página anterior.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  if (error && !data) {
    return <SessionUnavailable onRetry={refresh} />;
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
    return <Navigate to="/" replace />;
  }
  // User comum sem onboarding feito → tela de espera (admin precisa terminar)
  if (!data.onboardingDone && data.user.role !== 'ADMIN') {
    return <Navigate to="/pendente" replace />;
  }

  // App shell de altura fixa: o cabeçalho (Topbar) é um pill flutuante (não
  // ocupa espaço em fluxo) e o conteúdo rola dentro do <main>. /grafo ocupa a
  // tela toda e gerencia a própria altura, então não recebe overflow-y-auto
  // nem padding. /chat (e `/`, que agora É o chat em toda viewport) também
  // gerencia o próprio scroll (composer sticky).
  const isGraph = location.pathname === '/grafo' || location.pathname.startsWith('/grafo/');
  const isChat = isChatRoute(location.pathname);
  const isFullBleed = isGraph;
  // Botão de voltar flutuante (mobile): só em sub-páginas (não abas de topo) e
  // nunca em rotas que já têm chrome próprio de nav (ex.: /grafo).
  const showBack = showsMobileBack(location.pathname) && !hasOwnMobileChrome(location.pathname);
  // A bottom-nav mobile some na rota de chat (o rodapé é o promptbox, sem
  // espaço pra barra de navegação) além das rotas full-bleed (grafo).
  const hideBottomNav = hidesBottomNav(location.pathname, isDesktop);
  // Sem bottom-nav no chat mobile, o acesso à navegação vira um botão
  // flutuante que abre o drawer — nunca junto com o botão de voltar (a rota
  // de chat nunca é sub-página, então showBack já é false ali; o `!showBack`
  // é defensivo caso essa invariante mude no futuro).
  const showMobileNavButton = isChat && !isDesktop && !showBack;
  // Header flutuante (Topbar). No chat mobile o histórico passa por baixo do
  // chrome transparente — só reserva o safe-area; o scroller do chat adiciona
  // o offset inicial. Demais rotas mobile mantêm 4rem; desktop 5rem.
  const headerPad = isFullBleed
    ? ''
    : isChat
      ? ' pt-[env(safe-area-inset-top)] md:pt-[calc(env(safe-area-inset-top)+5rem)]'
      : ' pt-[calc(env(safe-area-inset-top)+4rem)] md:pt-[calc(env(safe-area-inset-top)+5rem)]';
  // O chat reserva o safe-area-inset-bottom pro composer não colar no
  // home-indicator; no desktop nunca teve bottom-nav mesmo, então zera.
  const chatBottomPad = isDesktop ? ' pb-0' : ' pb-[env(safe-area-inset-bottom)]';
  const mainClass = isFullBleed
    ? 'flex-1 min-h-0'
    : isChat
      ? 'flex-1 min-h-0 overflow-hidden' + chatBottomPad + headerPad
      : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6' +
        headerPad;

  return (
    <>
      <UpdateModal monitor={versionMonitor} />
      <div className="flex h-dvh overflow-hidden bg-[var(--color-app-bg)]">
        <Sidebar user={data.user} />
        <MobileNavDrawer
          user={data.user}
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
        <SidebarSpacer />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar user={data.user} />
          {showBack && <MobileBackButton />}
          {showMobileNavButton && <MobileMenuButton onOpen={() => setMobileNavOpen(true)} />}
          <main ref={mainRef} className={mainClass}>
            <AnimatedOutlet />
          </main>
          {!hideBottomNav && <MobileBottomNav user={data.user} />}
        </div>
      </div>
    </>
  );
}

/**
 * Agrupa rotas por seção pra animar a troca ENTRE seções sem remontar ao
 * navegar dentro da mesma seção (ex.: /notas/x→/notas/y, /jobs/1→/jobs/2
 * preservam estado e scroll).
 */
function getSectionKey(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0] ?? 'dashboard';
  // /admin/usuarios, /admin/custos e /admin/integracoes são seções distintas.
  return root === 'admin' ? `admin/${segments[1] ?? ''}` : root;
}

/**
 * Conteúdo da rota com transição de ENTRADA por seção. Remontar por key (em vez
 * de AnimatePresence mode="wait" + frozen router) faz cada página animar a
 * entrada via <AnimatedPage> sem NUNCA segurar a montagem do próximo conteúdo —
 * o que antes deixava a tela em branco ao navegar no build de produção.
 * Navegar dentro da mesma seção não remonta (mesma key), preservando estado e
 * scroll das notas e das páginas de detalhe.
 */
function AnimatedOutlet(): React.ReactElement {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <div key={getSectionKey(location.pathname)} className="contents">
      {outlet}
    </div>
  );
}
