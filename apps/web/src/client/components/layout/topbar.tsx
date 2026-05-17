import { Link, useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '../ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useMe } from '../../lib/hooks';
import { apiPost } from '../../lib/api';
import type { MeUser } from '../../lib/types';
import { Badge } from '../ui/badge';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Topbar({ user, title }: { user: MeUser; title?: string }): React.ReactElement {
  const navigate = useNavigate();
  const { refresh } = useMe();

  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--color-app-border)] bg-[var(--color-app-bg)]/70 backdrop-blur-md px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-base font-semibold font-display tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        {user.role === 'ADMIN' && (
          <Badge variant="success" className="hidden sm:inline-flex text-[10px]">
            <ShieldCheck className="h-3 w-3" />
            Admin
          </Badge>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg py-1.5 pl-1.5 pr-3 hover:bg-[var(--color-app-surface)] transition-colors group"
              aria-label="Menu do usuário"
            >
              <div className="relative">
                <Avatar className="bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-[var(--color-app-border-strong)]">
                  {user.image && (
                    <AvatarPrimitive.Image
                      src={user.image}
                      alt={user.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-transparent text-zinc-100 font-semibold">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-medium text-zinc-100">{user.name}</span>
                <span className="text-[11px] text-[var(--color-app-muted)] truncate max-w-[180px]">
                  {user.email}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Sua conta</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/conta" className="flex items-center gap-2 cursor-pointer">
                <UserIcon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
                <span className="truncate">Perfil</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onSignOut}>
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
