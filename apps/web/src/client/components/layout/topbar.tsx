import { useNavigate } from 'react-router-dom';
import { LogOut, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '../ui/avatar';
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
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-base font-semibold tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        {user.role === 'ADMIN' && (
          <Badge variant="muted" className="hidden sm:inline-flex">
            <ShieldDot /> Admin
          </Badge>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-3 rounded-md py-1.5 pl-2 pr-3 hover:bg-zinc-900/60 transition-colors"
              aria-label="Menu do usuário"
            >
              <Avatar>
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-medium text-zinc-100">{user.name}</span>
                <span className="text-[11px] text-zinc-500 truncate max-w-[160px]">
                  {user.email}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Conta</DropdownMenuLabel>
            <DropdownMenuItem>
              <UserIcon className="h-4 w-4 text-zinc-500" />
              {user.email}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onSignOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function ShieldDot(): React.ReactElement {
  return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />;
}
