import { useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ChevronDown,
  DollarSign,
  House,
  ListOrdered,
  MessageCircle,
  FolderPlus,
  ListVideo,
  LogOut,
  Network,
  Notebook,
  Plug,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Puzzle,
  ShieldCheck,
  Settings as SettingsIcon,
  Sparkles,
  Workflow,
} from '@/components/ui/icons';
import type { MeUser } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useSidebarCollapsed } from '../../lib/sidebar-state';
import { useIsDesktop } from '../../lib/use-media-query';
import { useNotes } from '../../lib/use-notes';
import { useI18n, type I18nKey } from '../../lib/i18n';
import {
  ICON_CUE_DURATION,
  ICON_CUE_PANEL_DELAY_MS,
  useIconCueGroup,
  useIconCueSignal,
  useIconCueTrigger,
} from '../../lib/icon-cue';
import { apiPost } from '../../lib/api';
import { useMe } from '../../lib/hooks';
import { NotesTree } from '../notes/notes-tree';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

export interface NavItem {
  to: string;
  labelKey: I18nKey;
  Icon: typeof House;
  adminOnly?: boolean;
}

/**
 * Lista canônica de destinos de navegação. Fonte única — consumida pela sidebar
 * desktop, pelo drawer mobile e pelo menu do Perfil da bottom-nav (que expõe os
 * destinos que não são abas de topo). Manter em sincronia com `BOTTOM_NAV_TABS`
 * em `lib/mobile-nav.ts`.
 */
export const NAV: NavItem[] = [
  { to: '/', labelKey: 'shell.nav.home', Icon: House },
  { to: '/chat', labelKey: 'shell.nav.chat', Icon: MessageCircle },
  { to: '/transcricoes', labelKey: 'shell.nav.library', Icon: ListVideo },
  { to: '/fila', labelKey: 'shell.nav.queue', Icon: ListOrdered },
  { to: '/notas', labelKey: 'shell.nav.notes', Icon: Notebook },
  { to: '/automacoes', labelKey: 'shell.nav.automations', Icon: Workflow },
  { to: '/grafo', labelKey: 'shell.nav.graph', Icon: Network },
  { to: '/extensao', labelKey: 'shell.nav.extension', Icon: Puzzle },
  { to: '/admin/usuarios', labelKey: 'shell.nav.users', Icon: ShieldCheck, adminOnly: true },
  { to: '/admin/custos', labelKey: 'shell.nav.costs', Icon: DollarSign, adminOnly: true },
  { to: '/admin/integracoes', labelKey: 'shell.nav.integrations', Icon: Plug, adminOnly: true },
  { to: '/setup', labelKey: 'shell.nav.settings', Icon: SettingsIcon, adminOnly: true },
];

const SIDEBAR_WIDTH = 288;
const RAIL_WIDTH = 60;

/**
 * Corpo modo-aware da sidebar: nav (default) | notas (em /notas). Reutilizado
 * pela sidebar desktop e pelo drawer mobile — qualquer item novo de navegação
 * aparece automaticamente nos dois.
 *
 * Troca entre modos sem AnimatePresence — `key` no motion.div força remount
 * limpo. AnimatePresence mode="wait" interno aqui acumulava estados pendentes
 * em cliques rápidos e travava.
 */
export function SidebarModeBody({
  user,
  hideHome = false,
  cueSignal = 0,
}: {
  user: MeUser;
  /** Oculta o item "Início" (desktop: `/` já É o chat, então é redundante). */
  hideHome?: boolean;
  /** Sinal de deixa dos ícones da nav — ver `NavBody`. */
  cueSignal?: number;
}): React.ReactElement {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN').filter(
    (n) => !hideHome || n.to !== '/',
  );
  const inNotas = location.pathname === '/notas' || location.pathname.startsWith('/notas/');
  const mode: 'nav' | 'notas' = inNotas ? 'notas' : 'nav';

  return (
    <motion.div
      key={`${mode}-mode`}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="flex-1 flex flex-col min-h-0"
    >
      {mode === 'notas' ? (
        <NotasModeBody items={items} pathname={location.pathname} />
      ) : (
        <NavBody items={items} pathname={location.pathname} cueSignal={cueSignal} />
      )}
    </motion.div>
  );
}

export function Sidebar({ user }: { user: MeUser }): React.ReactElement | null {
  const location = useLocation();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const isDesktop = useIsDesktop();
  const reduceMotion = useReducedMotion();

  // A deixa dos ícones da nav é um contador, não um booleano de montagem: só
  // uma MUDANÇA de sinal dispara. Assim o primeiro carregamento não pontua
  // (aí quem pontua é o cabeçalho da página), a troca de estado pontua uma
  // única vez, e o painel que está saindo de cena — que o `AnimatePresence`
  // rerenderiza com as props congeladas da última vez em que esteve presente —
  // nunca recebe sinal novo, então não varre ícones enquanto desaparece.
  const cueSignal = useIconCueTrigger(collapsed);

  // No mobile (< md) a navegação é o drawer + bottom-nav. A sidebar desktop e
  // seu corpo modo-aware (que monta os hooks pesados de notas) NÃO
  // são montados aqui — render condicional, não só CSS — pra manter o mobile
  // leve (sem fetches nem árvore de notas viva por trás).
  if (!isDesktop) return null;

  // Colapsada é o padrão em TODAS as páginas desktop (ver `sidebar-state.ts`):
  // mostra o rail fino de ícones com tooltip. Expandir persiste (fica aberta
  // até o usuário recolher de novo) — um único mecanismo de colapso, sem
  // forçamento especial por rota.
  return (
    <>
      <AnimatePresence>
        {collapsed && (
          <SidebarRail
            user={user}
            pathname={location.pathname}
            cueSignal={cueSignal}
            onExpand={() => setCollapsed(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={reduceMotion ? false : { x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }
            }
            className="hidden md:flex fixed top-4 bottom-4 left-4 z-40 flex-col rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 backdrop-blur-xl overflow-hidden"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <SidebarHeader onCollapse={() => setCollapsed(true)} />
            <SidebarModeBody user={user} hideHome cueSignal={cueSignal} />
            <SidebarChangelogButton />
            <SidebarSignOut />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Rail vertical de ícones — exibido quando a sidebar está colapsada, o padrão
 * em toda página desktop. Botão de
 * expandir no topo + atalhos de navegação (sem "Início", redundante — o
 * desktop já tem `/` como chat) com tooltip do nome no hover. Desktop-only.
 */
function SidebarRail({
  user,
  pathname,
  cueSignal,
  onExpand,
}: {
  user: MeUser;
  pathname: string;
  cueSignal: number;
  onExpand: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const { registerIcon, playCue } = useIconCueGroup(!reduceMotion);
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN').filter(
    (n) => n.to !== '/',
  );

  useIconCueSignal(playCue, cueSignal, ICON_CUE_PANEL_DELAY_MS);

  return (
    <motion.nav
      // Respeita prefers-reduced-motion: sem slide, aparição instantânea.
      initial={reduceMotion ? false : { opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }}
      className="hidden md:flex fixed top-4 bottom-4 left-4 z-40 flex-col items-center gap-1 rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 px-2 py-3 backdrop-blur-xl"
      style={{ width: RAIL_WIDTH }}
      aria-label={t('shell.openMenu')}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onExpand}
              className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]"
              aria-label={t('shell.expandSidebar')}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('shell.expandSidebar')}</TooltipContent>
        </Tooltip>

        <div className="my-1 h-px w-6 bg-[var(--color-app-border)]" />

        {items.map(({ to, labelKey, Icon }) => {
          const isActive = pathname === to || pathname.startsWith(to + '/');
          return (
            <Tooltip key={to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={to}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                    isActive
                      ? 'bg-[var(--color-app-surface-hover)] text-emerald-400'
                      : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
                  )}
                  aria-label={t(labelKey)}
                >
                  <Icon
                    ref={registerIcon(to)}
                    duration={ICON_CUE_DURATION}
                    className="h-[18px] w-[18px]"
                  />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{t(labelKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </motion.nav>
  );
}

export function SidebarChangelogButton(): React.ReactElement {
  const { t } = useI18n();

  return (
    <div className="shrink-0 px-3 py-1.5">
      <Link
        to="/novidades"
        title={t('shell.versionOpenChangelog')}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('shell.nav.changelog')}</span>
      </Link>
    </div>
  );
}

export function SidebarSignOut(): React.ReactElement {
  const { t } = useI18n();
  const { refresh } = useMe();
  const navigate = useNavigate();

  async function signOut(): Promise<void> {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  }

  return (
    <div className="shrink-0 border-t border-[var(--color-app-border)] p-3">
      <button
        type="button"
        onClick={() => void signOut()}
        className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--color-app-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-200"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('shell.signOut')}</span>
      </button>
    </div>
  );
}

function SidebarHeader({ onCollapse }: { onCollapse: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="flex items-center h-16 px-4 border-b border-[var(--color-app-border)] shrink-0">
      <div className="relative shrink-0 h-9 w-9">
        <img
          src="/voxen-256.png"
          alt="Voxen"
          width={36}
          height={36}
          draggable={false}
          className="rounded-lg select-none pointer-events-none"
        />
      </div>
      <div className="ml-3 flex min-w-0 flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
        <span className="mt-1 whitespace-nowrap text-[9px] uppercase tracking-[0.04em] text-[var(--color-app-muted)]">
          {t('shell.knowledgeBase')}
        </span>
      </div>
      <button
        type="button"
        onClick={onCollapse}
        className="ml-auto flex items-center justify-center h-7 w-7 rounded-md text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)] transition-colors"
        aria-label={t('shell.collapse')}
        title={t('shell.collapse')}
      >
        <PanelLeftClose className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modo normal — nav items
// ---------------------------------------------------------------------------

function NavBody({
  items,
  pathname,
  cueSignal = 0,
}: {
  items: NavItem[];
  pathname: string;
  /** Cada mudança de valor roda a deixa dos ícones — ver `useIconCueSignal`. */
  cueSignal?: number;
}): React.ReactElement {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const { registerIcon, playCue } = useIconCueGroup(!reduceMotion);

  useIconCueSignal(playCue, cueSignal, ICON_CUE_PANEL_DELAY_MS);

  return (
    <nav className="flex-1 p-3 overflow-y-auto">
      <ul className="space-y-0.5">
        {items.map(({ to, labelKey, Icon }) => {
          // `/` não pode usar prefix match — senão fica ativo em todas as rotas.
          const isActive =
            to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/');
          return (
            <li key={to} className="relative">
              {isActive && (
                <motion.div
                  layoutId={reduceMotion ? undefined : 'sidebar-pill'}
                  className="absolute inset-0 rounded-lg bg-[var(--color-app-surface-hover)] border border-[var(--color-app-border-strong)]"
                  transition={
                    reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }
                  }
                />
              )}
              <NavLink
                to={to}
                className={cn(
                  'relative z-10 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                  'transition-colors duration-150',
                  isActive
                    ? 'text-[var(--color-app-fg)]'
                    : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]',
                )}
              >
                <Icon
                  ref={registerIcon(to)}
                  duration={ICON_CUE_DURATION}
                  className={cn(
                    'h-[18px] w-[18px] transition-colors shrink-0',
                    isActive ? 'text-emerald-400' : 'text-[var(--color-app-muted)]',
                  )}
                />
                <span className="truncate">{t(labelKey)}</span>
                {isActive && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : 'sidebar-active-dot'}
                    className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 380, damping: 30 }
                    }
                  />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Modo notas — tree de notas/pastas + criar + voltar pra nav
// ---------------------------------------------------------------------------

function NotasModeBody({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}): React.ReactElement {
  const { t } = useI18n();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { create } = useNotes();
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeId = useMemo(() => {
    const m = pathname.match(/^\/notas\/([^/]+)/);
    return m?.[1] ?? undefined;
  }, [pathname]);

  async function onCreate(kind: 'NOTE' | 'FOLDER'): Promise<void> {
    setCreating(true);
    try {
      const note = await create(kind);
      if (note && kind === 'NOTE') {
        navigate(`/notas/${note.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 flex flex-col gap-2 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 h-9 rounded-lg px-3 text-[13px] font-medium text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('shell.backToHome')}
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void onCreate('NOTE')}
            disabled={creating}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] text-sm font-medium text-[var(--color-app-fg)] hover:border-violet-500/40 hover:bg-violet-500/5 transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t('shell.newNote')}
          </button>
          <button
            type="button"
            onClick={() => void onCreate('FOLDER')}
            disabled={creating}
            className="flex items-center justify-center h-10 w-10 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] text-[var(--color-app-muted)] hover:border-amber-500/40 hover:text-amber-300 hover:bg-amber-500/5 transition-colors disabled:opacity-50"
            aria-label={t('shell.newFolder')}
            title={t('shell.newFolder')}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        <NotesTree activeId={activeId} variant="sidebar" />
      </div>

      {/* Menu colapsável no rodapé (mesmo padrão do chat-mode) */}
      <div className="border-t border-[var(--color-app-border)] shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] transition-colors"
        >
          <ChevronDown
            className={cn(
              'h-3 w-3',
              !reduceMotion && 'transition-transform',
              menuOpen ? '' : 'rotate-180',
            )}
          />
          {t('shell.menu')}
        </button>
        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.ul
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              className="overflow-hidden px-3 pb-3 space-y-0.5"
            >
              {items
                .filter((n) => n.to !== '/notas')
                .map(({ to, labelKey, Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] hover:bg-[var(--color-app-surface)] transition-colors"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t(labelKey)}</span>
                    </NavLink>
                  </li>
                ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function SidebarSpacer(): React.ReactElement | null {
  const { collapsed } = useSidebarCollapsed();
  const isDesktop = useIsDesktop();
  const reduceMotion = useReducedMotion();
  // No mobile não há sidebar montada — sem spacer (evita reservar largura).
  if (!isDesktop) return null;
  const width = collapsed ? RAIL_WIDTH + 16 : SIDEBAR_WIDTH + 32;
  return (
    <motion.div
      className="hidden md:block shrink-0"
      animate={{ width }}
      initial={false}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }}
      aria-hidden
    />
  );
}
