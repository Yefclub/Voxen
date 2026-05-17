import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  ListVideo,
  PlayCircle,
  ShieldCheck,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { MeUser } from '../../lib/types';
import { cn } from '../../lib/utils';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Painel', Icon: LayoutDashboard },
  { to: '/jobs', label: 'Transcrever', Icon: PlayCircle },
  { to: '/transcricoes', label: 'Acervo', Icon: ListVideo },
  { to: '/admin/usuarios', label: 'Usuários', Icon: ShieldCheck, adminOnly: true },
  { to: '/setup', label: 'Configuração', Icon: SettingsIcon, adminOnly: true },
];

export function Sidebar({ user }: { user: MeUser }): React.ReactElement {
  const location = useLocation();
  const items = NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN');

  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 flex-col border-r border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/60 backdrop-blur-sm">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-[var(--color-app-border)]">
        <div className="relative">
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 blur-md opacity-40" />
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 text-zinc-950 font-bold text-sm tracking-tight font-display">
            V
          </div>
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] mt-1">
            knowledge base
          </span>
        </div>
      </div>

      {/* Nav com pill animado */}
      <nav className="flex-1 px-3 py-4 relative">
        <ul className="space-y-0.5">
          {items.map(({ to, label, Icon }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
            return (
              <li key={to} className="relative">
                {/* Indicator pill — desliza entre itens via layoutId */}
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
                    'relative z-10 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                    'transition-colors duration-150',
                    isActive
                      ? 'text-zinc-100'
                      : 'text-[var(--color-app-muted)] hover:text-zinc-100',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 transition-colors',
                      isActive ? 'text-emerald-400' : 'text-[var(--color-app-muted)]',
                    )}
                  />
                  <span>{label}</span>
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-dot"
                      className="ml-auto h-1 w-1 rounded-full bg-emerald-400"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer minúsculo com identidade */}
      <div className="border-t border-[var(--color-app-border)] p-4">
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-app-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/60 relative">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
          </span>
          <span className="uppercase tracking-[0.15em]">self-hosted · sem hype</span>
        </div>
      </div>
    </aside>
  );
}
