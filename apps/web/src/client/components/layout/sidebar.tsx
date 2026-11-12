import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { LogOut, PanelLeftClose, Sparkles } from '@/components/ui/icons';
import type { MeUser } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useSidebarCollapsed } from '../../lib/sidebar-state';
import { useIsDesktop } from '../../lib/use-media-query';
import { useI18n } from '../../lib/i18n';
import {
  ICON_CUE_DURATION,
  ICON_CUE_PANEL_DELAY_MS,
  useIconCueGroup,
  useIconCueSignal,
} from '../../lib/icon-cue';
import { apiPost } from '../../lib/api';
import { useMe } from '../../lib/hooks';
import { SidebarReleaseUpdateButton } from './sidebar-release-update';
import { NAV, NAV_SCOPES, NAV_SCOPE_LABELS, isNavItemActive, type NavItem } from './sidebar-nav';
export { NAV, isNavItemActive } from './sidebar-nav';

/**
 * Canonical navigation destinations shared by desktop, the mobile drawer, and
 * the bottom-nav profile menu. Keep top-level tabs aligned with
 * `BOTTOM_NAV_TABS` in `lib/mobile-nav.ts`.
 */
export const SIDEBAR_WIDTH = 244;

/**
 * A cor vem de `--color-app-danger` e não de um tom fixo do Tailwind: o app
 * troca de tema por variável CSS, sem variante `dark:`, e nenhum vermelho único
 * passa em AA nos dois extremos.
 */
const SIGN_OUT_HOVER_CLASS = 'hover:bg-rose-500/10 hover:text-[var(--color-app-danger)]';

/** Global navigation stays stable while each page owns its contextual tools. */
export function SidebarModeBody({
  user,
  cueSignal = 0,
}: {
  user: MeUser;
  /** Sinal de deixa dos ícones da nav — ver `NavBody`. */
  cueSignal?: number;
}): React.ReactElement {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN');

  return (
    <motion.div
      key="navigation"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="flex-1 flex flex-col min-h-0"
    >
      <NavBody items={items} pathname={location.pathname} cueSignal={cueSignal} />
    </motion.div>
  );
}

export function Sidebar({ user }: { user: MeUser }): React.ReactElement | null {
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const isDesktop = useIsDesktop();

  // No mobile (< md) a navegação é o drawer + bottom-nav. A sidebar desktop e
  // seu corpo modo-aware (que monta os hooks pesados de notas) NÃO
  // são montados aqui — render condicional, não só CSS — pra manter o mobile
  // leve (sem fetches nem árvore de notas viva por trás).
  if (!isDesktop) return null;

  // Camada estacionária e montada: a página opaca acima revela/cobre a
  // navegação; controles cobertos não recebem foco nem entrada.
  return (
    <aside
      id="desktop-sidebar"
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
      className="fixed inset-y-0 left-0 z-0 hidden flex-col overflow-hidden bg-[var(--color-app-bg)] md:flex"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <SidebarHeader onCollapse={() => setCollapsed(true)} />
      <SidebarModeBody user={user} />
      <SidebarReleaseUpdateButton />
      <SidebarChangelogButton />
      <SidebarSignOut />
    </aside>
  );
}

export function SidebarChangelogButton(): React.ReactElement {
  const { t } = useI18n();
  const label = t('shell.nav.changelog');

  return (
    <div className="shrink-0 px-3 py-1.5">
      <Link
        to="/novidades"
        title={t('shell.versionOpenChangelog')}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    </div>
  );
}

export function SidebarSignOut(): React.ReactElement {
  const { t } = useI18n();
  const { refresh } = useMe();
  const navigate = useNavigate();
  const label = t('shell.signOut');

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
        className={cn(
          'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--color-app-muted)] transition-colors',
          SIGN_OUT_HOVER_CLASS,
        )}
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

function SidebarHeader({ onCollapse }: { onCollapse: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className={cn('flex h-14 shrink-0 items-center px-4')}>
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
        <span className="text-lg font-semibold tracking-tight font-display">Voxen</span>
      </div>
      <button
        type="button"
        onClick={onCollapse}
        id="desktop-sidebar-close"
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
    <nav className="flex-1 overflow-y-auto p-3">
      <div className="space-y-4">
        {NAV_SCOPES.map((scope) => {
          const scopedItems = items.filter((item) => item.scope === scope);
          if (scopedItems.length === 0) return null;
          return (
            <section key={scope} aria-labelledby={`nav-scope-${scope}`}>
              <h2
                id={`nav-scope-${scope}`}
                className="mb-1.5 px-3 text-xs font-medium text-[var(--color-app-muted)]"
              >
                {t(NAV_SCOPE_LABELS[scope])}
              </h2>
              <ul className="space-y-0.5">
                {scopedItems.map(({ to, labelKey, Icon }) => {
                  const isActive = isNavItemActive(pathname, to);
                  return (
                    <li key={to} className="relative">
                      {isActive && (
                        <motion.div
                          layoutId={reduceMotion ? undefined : 'sidebar-pill'}
                          className="absolute inset-0 rounded-lg bg-[var(--color-accent-primary-soft)]"
                          transition={
                            reduceMotion
                              ? { duration: 0 }
                              : { type: 'spring', stiffness: 380, damping: 30 }
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
                            isActive
                              ? 'text-[var(--color-accent-primary)]'
                              : 'text-[var(--color-app-muted)]',
                          )}
                        />
                        <span className="truncate">{t(labelKey)}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
