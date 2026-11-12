import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useOutlet } from 'react-router-dom';
import { motion, useMotionValue, useReducedMotion } from 'motion/react';
import { Sidebar, SIDEBAR_WIDTH } from './sidebar';
import { MobileNavDrawer } from './mobile-nav-drawer';
import { MobileBottomNav } from './mobile-bottom-nav';
import { Topbar } from './topbar';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';
import { useVersionMonitor } from '../../lib/use-version-monitor';
import { UpdateModal } from '../update-modal';
import { useIsDesktop } from '../../lib/use-media-query';
import { useEdgeSwipe } from '../../lib/use-edge-swipe';
import {
  showsMobileBack,
  hasOwnMobileChrome,
  isChatRoute,
  hidesBottomNav,
  shouldResetMobileDrawerForDesktop,
} from '../../lib/mobile-nav';
import { TooltipProvider } from '../ui/tooltip';
import { SessionUnavailable } from '../session-unavailable';
import { useSidebarCollapsed } from '../../lib/sidebar-state';

const SURFACE_CORNER_RADIUS = 16;

export function AppLayout(): React.ReactElement {
  const { data, loading, error, refresh } = useMe();
  const { collapsed } = useSidebarCollapsed();
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  // Navegação mobile (<md): o Topbar flutuante não hospeda navegação — quem
  // faz isso é a bottom-nav (abas + menu do Perfil com os destinos únicos) +
  // botão de voltar flutuante + swipe da borda pra abrir o drawer (bônus).
  // Estado do drawer vive aqui pra ligar o edge-swipe e o botão de abrir menu
  // (rota de chat, onde a bottom-nav some) ao overlay.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileNavPresent, setMobileNavPresent] = useState(false);
  const mobileNavProgress = useMotionValue(0);
  const isDesktop = useIsDesktop();
  // Swipe da borda esquerda → direita abre o drawer; swipe de volta fecha. Só
  // ativo no mobile (no desktop a navegação é a sidebar). Hooks sempre rodam
  // (regras de hooks) — `enabled` controla o anexo dos listeners.
  useEdgeSwipe({
    enabled: !isDesktop,
    isOpen: mobileNavOpen,
    onOpen: () => setMobileNavOpen(true),
    onClose: () => setMobileNavOpen(false),
    onProgress: (progress) => mobileNavProgress.set(progress),
  });
  // Aviso de versão nova do backend — modal centralizado com o que mudou.
  const versionMonitor = useVersionMonitor(!!data?.user);
  const sectionKey = getSectionKey(location.pathname);

  // O scroll vive no <main>. Trocas dentro da mesma seção preservam a posição
  // (notas/detalhes); seções novas voltam ao topo antes da pintura, sem salto.
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [sectionKey]);

  useLayoutEffect(() => {
    if (
      !shouldResetMobileDrawerForDesktop(
        isDesktop,
        mobileNavOpen,
        mobileNavPresent,
        mobileNavProgress.get(),
      )
    ) {
      return;
    }
    setMobileNavOpen(false);
    setMobileNavPresent(false);
    mobileNavProgress.set(0);
  }, [isDesktop, mobileNavOpen, mobileNavPresent, mobileNavProgress]);

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

  // A API já tem guards próprios, mas não montar a tela administrativa evita
  // confundir usuários comuns e impede flashes de conteúdo ao colar uma URL.
  if (
    data.user.role !== 'ADMIN' &&
    (location.pathname === '/setup' ||
      location.pathname === '/admin' ||
      location.pathname.startsWith('/admin/'))
  ) {
    return <Navigate to="/" replace />;
  }

  const isFullBleed = hasOwnMobileChrome(location.pathname);
  const showBack = showsMobileBack(location.pathname) && !isFullBleed;
  const hideBottomNav = hidesBottomNav(location.pathname, isDesktop);
  const mainClass = isFullBleed
    ? 'flex-1 min-h-0'
    : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-4';

  return (
    <TooltipProvider delayDuration={350}>
      <UpdateModal monitor={versionMonitor} />
      <div
        data-interface-mode="focus"
        className="flex h-dvh overflow-hidden bg-[var(--color-app-bg)]"
      >
        <Sidebar user={data.user} />
        <MobileNavDrawer
          user={data.user}
          open={mobileNavOpen}
          progress={mobileNavProgress}
          onClose={() => setMobileNavOpen(false)}
          onPresenceChange={setMobileNavPresent}
        />
        <motion.div
          data-app-surface
          initial={false}
          animate={{
            // Move a borda curva para fora da viewport em vez de achatá-la
            // durante a transição. O padding mantém o conteúdo fechado em x=0.
            marginLeft: isDesktop ? (collapsed ? -SURFACE_CORNER_RADIUS : SIDEBAR_WIDTH) : 0,
            paddingLeft: isDesktop && collapsed ? SURFACE_CORNER_RADIUS : 0,
          }}
          style={{
            borderTopLeftRadius: isDesktop ? SURFACE_CORNER_RADIUS : 0,
            borderBottomLeftRadius: isDesktop ? SURFACE_CORNER_RADIUS : 0,
          }}
          transition={{
            duration: reduceMotion || !isDesktop ? 0 : 0.22,
            ease: [0.4, 0, 0.2, 1],
          }}
          className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-app-bg)] md:overflow-hidden md:bg-[var(--color-app-bg)]"
          inert={mobileNavPresent ? true : undefined}
        >
          <Topbar
            user={data.user}
            showBack={showBack}
            showMobileMenu={!showBack && !isDesktop && isFullBleed}
            onOpenMobileNav={() => setMobileNavOpen(true)}
          />
          <main ref={mainRef} className={mainClass}>
            <AnimatedOutlet />
          </main>
          {!hideBottomNav && <MobileBottomNav user={data.user} />}
        </motion.div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Agrupa rotas por seção pra animar a troca ENTRE seções sem remontar ao
 * navegar dentro da mesma seção (ex.: /notas/x→/notas/y, /jobs/1→/jobs/2
 * preservam estado e scroll).
 */
function getSectionKey(pathname: string): string {
  if (isChatRoute(pathname)) return 'chat';
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0] ?? 'dashboard';
  // Administration has its own shell; switching tabs does not remount the domain.
  return root === 'admin' ? 'admin' : root;
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
    <Suspense fallback={<RouteLoading />}>
      <div key={getSectionKey(location.pathname)} className="contents">
        {outlet}
      </div>
    </Suspense>
  );
}

function RouteLoading(): React.ReactElement {
  return (
    <div
      data-route-loading
      aria-busy="true"
      className="mx-auto min-h-full w-full max-w-[1600px] px-4 pb-5 pt-0 sm:px-7 sm:pb-9 sm:pt-0 md:pt-5 xl:px-10"
    >
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--color-app-surface)]">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-[var(--color-accent-violet)]" />
      </div>
      <div className="mt-8 space-y-4" aria-hidden>
        <div className="h-8 w-52 animate-pulse rounded-lg bg-[var(--color-app-surface)]" />
        <div className="h-4 max-w-xl animate-pulse rounded bg-[var(--color-app-surface)]/75" />
        <div className="mt-8 h-40 animate-pulse rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/45" />
      </div>
      <span className="sr-only">Carregando tela</span>
    </div>
  );
}
