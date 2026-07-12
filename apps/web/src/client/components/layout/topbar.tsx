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
import { useI18n } from '../../lib/i18n';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Cabeçalho do shell — **desktop-only**. No mobile NÃO há header nenhum no topo
 * (ver `app-layout`): a navegação é bottom-nav + botão de voltar flutuante +
 * edge-swipe pro drawer. Hospeda o menu de usuário (que no mobile vive na
 * bottom-nav).
 */
export function Topbar({ user, title }: { user: MeUser; title?: string }): React.ReactElement {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const { t } = useI18n();
  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  return (
    <header
      className="relative z-30 hidden h-16 shrink-0 items-center justify-between border-b border-[var(--color-app-border)] bg-[var(--color-app-bg)]/82 px-4 backdrop-blur-md md:flex sm:px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center gap-2 sm:gap-4">
        {title && <h1 className="text-base font-semibold font-display tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        {/* Avatar/menu de usuário: só no desktop (< md vai pra bottom-nav). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hidden md:block rounded-full ring-offset-2 ring-offset-[var(--color-app-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 hover:opacity-90 transition-opacity"
              aria-label={t('shell.userMenu')}
            >
              <Avatar className="h-9 w-9 bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-[var(--color-app-border-strong)]">
                {user.image && (
                  <AvatarPrimitive.Image
                    src={user.image}
                    alt={user.name}
                    className="h-full w-full object-cover"
                  />
                )}
                <AvatarFallback className="bg-transparent text-zinc-100 font-semibold text-xs">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col items-start gap-0.5 py-2.5">
              <div className="flex items-center gap-2 w-full">
                <span className="text-sm font-medium text-zinc-100 truncate flex-1">
                  {user.name}
                </span>
                {user.role === 'ADMIN' && (
                  <Badge variant="success" className="text-[9px] shrink-0">
                    <ShieldCheck className="h-2.5 w-2.5" />
                    {t('shell.admin')}
                  </Badge>
                )}
              </div>
              <span className="text-[11px] text-[var(--color-app-muted)] truncate w-full font-normal">
                {user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/conta" className="flex items-center gap-2 cursor-pointer">
                <UserIcon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
                <span className="truncate">{t('common.profile')}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onSignOut}>
              <LogOut className="h-3.5 w-3.5" />
              {t('common.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
