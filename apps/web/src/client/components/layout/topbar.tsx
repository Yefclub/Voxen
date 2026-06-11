import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LogOut, Menu, ShieldCheck, User as UserIcon } from 'lucide-react';
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
import { useChatContextState } from '../../lib/chat-context-ctx';
import type { MeUser } from '../../lib/types';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { useI18n, type TranslateFn } from '../../lib/i18n';

function ContextIndicator({
  tokens,
  limit,
  onOpenSummary,
  t,
}: {
  tokens: number;
  limit: number;
  onOpenSummary?: () => void;
  t: TranslateFn;
}): React.ReactElement {
  const pct = limit > 0 ? (tokens / limit) * 100 : 0;
  const tone = pct >= 80 ? 'rose' : pct >= 60 ? 'amber' : 'emerald';
  const toneClass = {
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-300' },
    amber: { bar: 'bg-amber-500', text: 'text-amber-300' },
    rose: { bar: 'bg-rose-500', text: 'text-rose-300' },
  } as const;
  const toneStyles = toneClass[tone];
  // Compacto pra caber ao lado do avatar — só barrinha + % + título.
  return (
    <div
      className="hidden sm:flex items-center gap-2.5 pl-3 pr-3 py-1.5 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/60"
      title={t('shell.contextTitle', {
        tokens: tokens.toLocaleString(),
        limit: limit.toLocaleString(),
      })}
    >
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] font-medium">
        Ctx
      </span>
      <div className="w-20 h-1.5 rounded-full bg-[var(--color-app-bg)] overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', toneStyles.bar)}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className={cn('text-[11px] tabular-nums font-mono', toneStyles.text)}>
        {pct.toFixed(0)}%
      </span>
      {onOpenSummary && (
        <button
          type="button"
          onClick={onOpenSummary}
          className="text-[10px] uppercase tracking-wider text-violet-300 hover:text-violet-200 transition-colors"
          title={t('shell.contextSummary')}
        >
          ↗
        </button>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Topbar({
  user,
  title,
  onOpenMobileNav,
}: {
  user: MeUser;
  title?: string;
  onOpenMobileNav?: () => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const { t } = useI18n();
  const { usage, lastCompaction, requestOpenSummary } = useChatContextState();

  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  return (
    <header className="relative shrink-0 z-30 flex h-16 items-center justify-between border-b border-[var(--color-app-border)] bg-[var(--color-app-bg)]/70 backdrop-blur-md px-6">
      <div className="flex items-center gap-4">
        {onOpenMobileNav && (
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] hover:border-[var(--color-app-border-strong)] transition-colors"
            aria-label={t('shell.openMenu')}
            title={t('shell.openMenu')}
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {title && <h1 className="text-base font-semibold font-display tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        {usage && (
          <ContextIndicator
            tokens={usage.tokens}
            limit={usage.limit}
            onOpenSummary={lastCompaction ? requestOpenSummary : undefined}
            t={t}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-full ring-offset-2 ring-offset-[var(--color-app-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 hover:opacity-90 transition-opacity"
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
