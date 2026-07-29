import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ListVideo,
  LogOut,
  MessageCircle,
  Network,
  Notebook,
  ShieldCheck,
  User as UserIcon,
} from '@/components/ui/icons';
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
import { Badge } from '../ui/badge';
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
  Icon: typeof MessageCircle;
}

const ITEMS: MobileNavItem[] = [
  { to: '/', labelKey: 'shell.nav.chat', Icon: MessageCircle },
  { to: '/transcricoes', labelKey: 'shell.nav.library', Icon: ListVideo },
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
  const navigate = useNavigate();
  const { t } = useI18n();
  const { refresh } = useMe();

  // Destinos únicos que NÃO são abas da bottom-nav (notas, automações, setup +
  // admin) entram no menu do Perfil pra não dependerem do swipe/drawer.
  // Fonte canônica = NAV da sidebar; aplica o mesmo gate de admin por role.
  const menuItems = NAV.filter(
    (n) => !isBottomNavTab(n.to) && (!n.adminOnly || user.role === 'ADMIN'),
  );

  async function onSignOut(): Promise<void> {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  }

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-app-border)] bg-[var(--color-app-bg)]/95 backdrop-blur-xl"
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
                  ? 'text-emerald-300'
                  : 'text-[var(--color-app-muted)] active:text-[var(--color-app-fg)]',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={cn(
                  'flex h-8 w-10 items-center justify-center rounded-full transition-colors',
                  active ? 'bg-emerald-500/15' : 'bg-transparent',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{t(labelKey)}</span>
            </NavLink>
          );
        })}

        {/* Perfil/usuário — abre menu pra cima (Perfil / Sair). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium text-[var(--color-app-muted)] transition-colors active:text-[var(--color-app-fg)]"
              aria-label={t('shell.userMenu')}
            >
              <span className="flex h-8 w-10 items-center justify-center">
                <Avatar className="h-7 w-7 bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-[var(--color-app-border-strong)]">
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
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            sideOffset={8}
            className="w-60 mb-1 max-h-[min(70vh,28rem)] overflow-y-auto"
            style={{ marginBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
          >
            <DropdownMenuLabel className="flex flex-col items-start gap-0.5 py-2.5">
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
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/conta" className="flex items-center gap-2 cursor-pointer">
                <UserIcon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
                <span className="truncate">{t('common.profile')}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Destinos únicos (não-abas): dashboard, notas, automações, setup +
                admin. NavLinks fecham o dropdown ao navegar (comportamento padrão
                do DropdownMenuItem ao clicar). */}
            {menuItems.map(({ to, labelKey, Icon }) => (
              <DropdownMenuItem key={to} asChild>
                <NavLink to={to} className="flex items-center gap-2 cursor-pointer">
                  <Icon className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
                  <span className="truncate">{t(labelKey)}</span>
                </NavLink>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => void onSignOut()}>
              <LogOut className="h-3.5 w-3.5" />
              {t('common.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
