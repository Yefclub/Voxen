import { NavLink } from 'react-router-dom';
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
  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 flex-col border-r border-zinc-800/80 bg-zinc-950/60">
      <div className="flex h-16 items-center gap-3 px-6 border-b border-zinc-800/80">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500 text-emerald-950 font-bold text-sm tracking-tight">
          V
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">Voxen</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">
            knowledge base
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.filter((n) => !n.adminOnly || user.role === 'ADMIN').map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                'transition-colors duration-150',
                isActive
                  ? 'bg-zinc-800/70 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isActive ? 'text-emerald-400' : 'text-zinc-500',
                  )}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-zinc-800/80 p-4 text-[11px] text-zinc-500 leading-relaxed">
        Self-hosted · sem embeddings · sem hype.
      </div>
    </aside>
  );
}
