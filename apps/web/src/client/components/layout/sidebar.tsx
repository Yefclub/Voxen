import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  ListVideo,
  PlayCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { MeUser } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useSidebarCollapsed } from '../../lib/sidebar-state';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Painel', Icon: LayoutDashboard },
  { to: '/jobs', label: 'Transcrever', Icon: PlayCircle },
  { to: '/transcricoes', label: 'Biblioteca', Icon: ListVideo },
  { to: '/admin/usuarios', label: 'Usuários', Icon: ShieldCheck, adminOnly: true },
  { to: '/setup', label: 'Configuração', Icon: SettingsIcon, adminOnly: true },
];

const SIDEBAR_WIDTH = 248;

export function Sidebar({ user }: { user: MeUser }): React.ReactElement {
  const location = useLocation();
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN');
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <>
      {/* Botão flutuante de abrir (visível só quando colapsada). Entra
          DEPOIS que a sidebar termina de sair (delay 0.2s no initial). */}
      <AnimatePresence>
        {collapsed && (
          <motion.button
            type="button"
            onClick={toggle}
            initial={{ opacity: 0, scale: 0.6, x: -12 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.6, x: -12 }}
            transition={{
              type: 'spring',
              stiffness: 360,
              damping: 26,
              delay: 0.18,
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="hidden md:flex fixed top-4 left-4 z-50 h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] hover:border-[var(--color-app-border-strong)] transition-colors"
            aria-label="Abrir menu"
            title="Abrir menu"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Sidebar — slide-out completo quando colapsada */}
      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={{ x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="hidden md:flex fixed top-4 bottom-4 left-4 z-40 flex-col rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 backdrop-blur-xl overflow-hidden"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <div className="flex items-center h-16 px-4 border-b border-[var(--color-app-border)]">
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
              <div className="ml-3 flex flex-col leading-none min-w-0">
                <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] mt-1 truncate">
                  base de conhecimento
                </span>
              </div>
              <button
                type="button"
                onClick={toggle}
                className="ml-auto flex items-center justify-center h-7 w-7 rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors"
                aria-label="Recolher"
                title="Recolher"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 p-3 overflow-y-auto">
              <ul className="space-y-0.5">
                {items.map(({ to, label, Icon }) => {
                  const isActive =
                    location.pathname === to || location.pathname.startsWith(to + '/');
                  return (
                    <li key={to} className="relative">
                      {isActive && (
                        <motion.div
                          layoutId="sidebar-pill"
                          className="absolute inset-0 rounded-lg bg-[var(--color-app-surface-hover)] border border-[var(--color-app-border-strong)]"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      )}
                      <NavLink
                        to={to}
                        className={cn(
                          'relative z-10 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                          'transition-colors duration-150',
                          isActive
                            ? 'text-zinc-100'
                            : 'text-[var(--color-app-muted)] hover:text-zinc-100',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] transition-colors shrink-0',
                            isActive ? 'text-emerald-400' : 'text-[var(--color-app-muted)]',
                          )}
                        />
                        <span className="truncate">{label}</span>
                        {isActive && (
                          <motion.span
                            layoutId="sidebar-active-dot"
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                          />
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Espaçador que reserva o espaço horizontal ocupado pela sidebar.
 * Quando colapsada → 0px (conteúdo ocupa tudo).
 * Quando aberta → SIDEBAR_WIDTH + 2× margem (left-4 + right offset).
 *
 * Anima junto com a sidebar (mesmo timing/easing) graças ao store
 * singleton em useSidebarCollapsed — Sidebar e Spacer recebem o
 * mesmo `collapsed` simultaneamente.
 */
export function SidebarSpacer(): React.ReactElement {
  const { collapsed } = useSidebarCollapsed();
  return (
    <motion.div
      className="hidden md:block shrink-0"
      animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH + 32 }}
      initial={false}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      aria-hidden
    />
  );
}
