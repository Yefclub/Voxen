import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from '../ui/dialog';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ListVideo,
  LogOut,
  Download,
  Network,
  Notebook,
  User as UserIcon,
} from '@/components/ui/icons';
import { Avatar, AvatarFallback } from '../ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '../../lib/utils';
import { useI18n, type I18nKey } from '../../lib/i18n';
import { useMe } from '../../lib/hooks';
import { apiPost } from '../../lib/api';
import type { MeUser } from '../../lib/types';
import { NAV } from './sidebar';
import { isBottomNavTab } from '../../lib/mobile-nav';

interface MobileNavItem {
  to: string;
  labelKey: I18nKey;
  Icon: typeof Download;
}

const ITEMS: MobileNavItem[] = [
  { to: '/transcricoes', labelKey: 'shell.nav.library', Icon: ListVideo },
  { to: '/capturar', labelKey: 'shell.nav.capture', Icon: Download },
  { to: '/notas', labelKey: 'shell.nav.notes', Icon: Notebook },
  { to: '/grafo', labelKey: 'shell.nav.graph', Icon: Network },
];

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
 * Barra de navegação inferior do mobile (< md). Além dos itens de navegação,
 * hospeda o acesso ao perfil/usuário (movido do topbar no mobile): avatar +
 * menu com Perfil e Sair.
 */
export function MobileBottomNav({ user }: { user: MeUser }): React.ReactElement {
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();
  const { refresh } = useMe();

  // Destinations outside the bottom tabs live in the profile menu. The sidebar
  // NAV remains canonical and applies the same role gate here.
  const menuItems = NAV.filter(
    (n) => n.to !== '/conta' && !isBottomNavTab(n.to) && (!n.adminOnly || user.role === 'ADMIN'),
  );
  const menuGroups = [
    { scope: 'workspace', labelKey: 'shell.navGroup.workspace' },
    { scope: 'personal', labelKey: 'shell.navGroup.personal' },
    { scope: 'admin', labelKey: 'shell.navGroup.admin' },
  ] as const;

  async function onSignOut(): Promise<void> {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  }

  return (
    <nav
      data-mobile-bottom-nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0px)' }}
      aria-label={t('shell.menu')}
    >
      <div className="grid h-16 grid-cols-5 px-1">
        {ITEMS.map(({ to, labelKey, Icon }) => {
          const active =
            to === '/'
              ? location.pathname === '/'
              : location.pathname === to || location.pathname.startsWith(`${to}/`);
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition-colors',
                active
                  ? 'text-[var(--color-accent-primary)]'
                  : 'text-[var(--color-app-muted)] active:text-[var(--color-app-fg)]',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={cn(
                  'flex h-8 w-10 items-center justify-center rounded-full transition-colors',
                  active ? 'bg-[var(--color-accent-primary-soft)]' : 'bg-transparent',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{t(labelKey)}</span>
            </NavLink>
          );
        })}

        {/* Perfil/usuário — abre menu pra cima (Perfil / Sair). */}
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium text-[var(--color-app-muted)] transition-colors active:text-[var(--color-app-fg)]"
              aria-label={t('shell.userMenu')}
            >
              <span className="flex h-8 w-10 items-center justify-center">
                <Avatar className="h-7 w-7 bg-[var(--color-app-surface)]">
                  {user.image && (
                    <AvatarPrimitive.Image
                      src={user.image}
                      alt={user.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-transparent text-[var(--color-app-fg)] font-semibold text-[10px]">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </span>
              <span className="max-w-full truncate">{t('common.profile')}</span>
            </button>
          </DialogTrigger>
          <DialogContent className="gap-5">
            <DialogTitle>{user.name}</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
            <DialogClose asChild>
              <Link
                to="/conta"
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-[var(--color-app-surface)]"
              >
                <UserIcon className="h-4 w-4" />
                {t('common.profile')}
              </Link>
            </DialogClose>
            {/* Unique non-tab destinations, grouped by product domain. */}
            {menuGroups.map(({ scope, labelKey }) => {
              const groupItems = menuItems.filter((item) => item.scope === scope);
              if (groupItems.length === 0) return null;
              return (
                <div key={scope}>
                  <p className="px-3 py-2 text-xs font-medium text-[var(--color-app-muted)]">
                    {t(labelKey)}
                  </p>
                  {groupItems.map(({ to, labelKey: itemLabelKey, Icon }) => (
                    <DialogClose key={to} asChild>
                      <NavLink
                        to={to}
                        className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-[var(--color-app-surface)]"
                      >
                        <Icon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
                        <span className="truncate">{t(itemLabelKey)}</span>
                      </NavLink>
                    </DialogClose>
                  ))}
                </div>
              );
            })}

            <button
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-[var(--color-app-danger)] hover:bg-[var(--color-app-surface)]"
              onClick={() => void onSignOut()}
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('common.signOut')}
            </button>
          </DialogContent>
        </Dialog>
      </div>
    </nav>
  );
}
