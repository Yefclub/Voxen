import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuDivider,
} from '@astryxdesign/core/DropdownMenu';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { ChevronDown, LogOut, ShieldCheck, User as UserIcon } from '../ui/icons';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { useMe } from '../../lib/hooks';
import { apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import type { MeUser } from '../../lib/types';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const chromeControlClass =
  'inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)] md:h-8 md:w-8';

export function AccountMenu({
  user,
  sidebar = false,
  compact = false,
}: {
  user: MeUser;
  sidebar?: boolean;
  compact?: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const { refresh } = useMe();
  const navigate = useNavigate();
  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };
  return (
    <DropdownMenu
      presentation="popover"
      alignment="end"
      menuWidth={240}
      className="voxen-account-menu"
      header={
        <div className="px-3 py-3 border-b border-[var(--color-app-border)]">
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm font-medium text-[var(--color-app-fg)] truncate flex-1">
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
        </div>
      }
      renderTrigger={(triggerProps) => (
        <button
          type="button"
          {...triggerProps}
          className={cn(
            chromeControlClass,
            'overflow-hidden p-0 ring-offset-2 ring-offset-[var(--color-app-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)]',
            sidebar &&
              'h-12 w-full justify-start gap-3 rounded-lg px-2 hover:bg-[var(--color-app-surface)]',
            compact && 'h-11 w-11 justify-center px-0',
          )}
          aria-label={`${t('shell.userMenu')}: ${initials(user.name)} ${user.name}`}
        >
          <Avatar aria-hidden="true" className="h-8 w-8 bg-[var(--color-accent-primary-soft)]">
            {user.image && (
              <AvatarPrimitive.Image
                src={user.image}
                alt={user.name}
                className="h-full w-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-[var(--color-app-fg)] font-semibold text-xs">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>{' '}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left text-sm font-medium',
              (!sidebar || compact) && 'hidden',
            )}
          >
            {user.name}
          </span>
          <ChevronDown
            aria-hidden="true"
            isAnimated={false}
            className={cn('h-3.5 w-3.5 shrink-0', (!sidebar || compact) && 'hidden')}
          />
        </button>
      )}
    >
      <DropdownMenuItem
        href="/conta"
        label={t('common.profile')}
        icon={<UserIcon className="h-4 w-4" />}
      />
      <DropdownMenuDivider />
      <DropdownMenuItem
        label={t('common.signOut')}
        icon={<LogOut className="h-4 w-4" />}
        variant="destructive"
        onClick={() => void onSignOut()}
      />
    </DropdownMenu>
  );
}
