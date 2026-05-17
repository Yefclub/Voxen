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

export function Sidebar({ user }: { user: MeUser }): React.ReactElement {
  const location = useLocation();
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN');
  const { collapsed, toggle } = useSidebarCollapsed();
  const width = collapsed ? 76 : 248;

  return (
    <motion.aside
      animate={{ width }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      className="hidden md:flex fixed top-4 bottom-4 left-4 z-40 flex-col rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 backdrop-blur-xl shadow-2xl shadow-black/30 overflow-hidden"
      style={{ width }}
    >
      {/* Logo + toggle */}
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
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="ml-3 flex flex-col leading-none min-w-0"
            >
              <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] mt-1 truncate">
                knowledge base
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'ml-auto flex items-center justify-center h-7 w-7 rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors',
            collapsed && 'mx-auto',
          )}
          aria-label={collapsed ? 'Expandir' : 'Recolher'}
          title={collapsed ? 'Expandir' : 'Recolher'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {items.map(({ to, label, Icon }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
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
                    collapsed && 'justify-center',
                    isActive
                      ? 'text-zinc-100'
                      : 'text-[var(--color-app-muted)] hover:text-zinc-100',
                  )}
                  title={collapsed ? label : undefined}
                >
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] transition-colors shrink-0',
                      isActive ? 'text-emerald-400' : 'text-[var(--color-app-muted)]',
                    )}
                  />
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.05 }}
                      className="truncate"
                    >
                      {label}
                    </motion.span>
                  )}
                  {isActive && !collapsed && (
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
  );
}

// Espaçador que reserva a área ocupada pela sidebar fixed.
export function SidebarSpacer(): React.ReactElement {
  const { collapsed } = useSidebarCollapsed();
  return (
    <div
      className="hidden md:block shrink-0 transition-[width] duration-300"
      style={{ width: collapsed ? 76 + 16 + 16 : 248 + 16 + 16 }}
      aria-hidden
    />
  );
}
