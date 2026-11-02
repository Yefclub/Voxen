import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  LogOut,
  Moon,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
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
import { useMe } from '../../lib/hooks';
import { apiPost } from '../../lib/api';
import type { MeUser } from '../../lib/types';
import { Badge } from '../ui/badge';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-provider';
import { APP_THEMES, readLastDarkTheme, type AppTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { hidesBottomNav } from '../../lib/mobile-nav';
import { useSidebarCollapsed } from '../../lib/sidebar-state';
import { NAV, isNavItemActive } from './sidebar-nav';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { MobileBackButton } from './mobile-back-button';
import { MobileMenuButton } from './mobile-menu-button';
import { IconButton } from '../ui/icon-button';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const THEME_LABEL_KEY: Record<
  AppTheme,
  'theme.linear' | 'theme.zinc' | 'theme.emerald' | 'theme.light'
> = {
  linear: 'theme.linear',
  zinc: 'theme.zinc',
  emerald: 'theme.emerald',
  light: 'theme.light',
};

const chromeControlClass =
  'inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 md:h-8 md:w-8';

interface TopbarProps {
  user: MeUser;
  showBack: boolean;
  showMobileMenu: boolean;
  onOpenMobileNav: () => void;
}

export function Topbar({
  user,
  showBack,
  showMobileMenu,
  onOpenMobileNav,
}: TopbarProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useMe();
  const { t } = useI18n();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const openSidebarRef = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(collapsed);
  const mobileUserMenuNeeded = hidesBottomNav(location.pathname, false);
  const activeItem = NAV.filter((item) => isNavItemActive(location.pathname, item.to)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  const sectionLabel = activeItem
    ? t(activeItem.labelKey)
    : location.pathname.startsWith('/novidades')
      ? t('novidades.title')
      : t('shell.knowledgeBase');
  useLayoutEffect(() => {
    if (previousCollapsed.current === collapsed) return;
    previousCollapsed.current = collapsed;
    const control = collapsed
      ? openSidebarRef.current
      : document.getElementById('desktop-sidebar-close');
    control?.focus({ preventScroll: true });
  }, [collapsed]);
  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  return (
    <header
      data-app-header
      className="relative z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-3 border-b border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-3 pt-[env(safe-area-inset-top)] md:h-14 md:pt-0"
    >
      <div className="flex min-w-0 items-center gap-3">
        {collapsed && (
          <>
            <IconButton
              ref={openSidebarRef}
              type="button"
              onClick={() => setCollapsed(false)}
              data-sidebar-toggle
              className={cn(chromeControlClass, 'hidden md:inline-flex')}
              label={t('shell.expandSidebar')}
              aria-expanded={false}
              aria-controls="desktop-sidebar"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            </IconButton>
            <span
              aria-hidden
              className="hidden h-4 w-px shrink-0 bg-[var(--color-app-border)] md:block"
            />
          </>
        )}
        {showBack && <MobileBackButton />}
        {showMobileMenu && <MobileMenuButton onOpen={onOpenMobileNav} />}
        <nav aria-label={t('shell.currentSection')} className="min-w-0 text-[13px]">
          <span
            aria-current="page"
            className="block truncate font-medium text-[var(--color-app-subtle)]"
          >
            {sectionLabel}
          </span>
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <AppearanceMenu />
        <div
          className={cn(
            'border-l border-[var(--color-app-border)] pl-2 sm:pl-3',
            !mobileUserMenuNeeded && 'max-md:hidden',
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  chromeControlClass,
                  'overflow-hidden p-0 ring-offset-2 ring-offset-[var(--color-app-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 md:rounded-full',
                )}
                aria-label={t('shell.userMenu')}
              >
                <Avatar className="h-8 w-8 bg-gradient-to-br from-emerald-500/30 to-violet-500/30">
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
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
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
              <DropdownMenuItem destructive onSelect={onSignOut}>
                <LogOut className="h-3.5 w-3.5" />
                {t('common.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function AppearanceMenu(): React.ReactElement {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const light = theme === 'light';

  return (
    <div role="group" aria-label={t('theme.appearance')} className="flex items-center gap-1">
      <ToggleGroup
        aria-label={t('theme.label')}
        value={[light ? 'light' : 'dark']}
        onValueChange={(next) => {
          const mode = next[0];
          if (mode === 'light' && !light) void setTheme('light');
          if (mode === 'dark' && light) void setTheme(readLastDarkTheme());
        }}
        className="hidden md:flex"
      >
        <ToggleGroupItem value="light" label={t('theme.switchToLight')}>
          <Sun isAnimated={false} className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="dark" label={t('theme.switchToDark')}>
          <Moon isAnimated={false} className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
      <Popover>
        <PopoverTrigger asChild>
          <IconButton type="button" label={t('theme.appearance')} className={chromeControlClass}>
            <span aria-hidden className="md:hidden">
              {light ? (
                <Sun isAnimated={false} className="h-4 w-4" />
              ) : (
                <Moon isAnimated={false} className="h-4 w-4" />
              )}
            </span>
            <span aria-hidden className="hidden md:inline-flex">
              <ChevronDown isAnimated={false} className="h-3.5 w-3.5" />
            </span>
          </IconButton>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          aria-label={t('theme.appearance')}
          className="w-56 max-w-[calc(100vw-2rem)] rounded-xl border-0 p-2 shadow-lg"
        >
          <fieldset>
            <legend className="px-2 py-2 text-xs font-medium text-[var(--color-app-muted)]">
              {t('theme.label')}
            </legend>
            <div className="space-y-0.5">
              {APP_THEMES.map((id) => (
                <label
                  key={id}
                  className="relative flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-[13px] text-[var(--color-app-subtle)] transition-colors hover:bg-[var(--color-app-surface)] has-[:checked]:bg-[var(--color-app-surface)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-500/40"
                >
                  <input
                    type="radio"
                    name="voxen-theme"
                    value={id}
                    checked={theme === id}
                    onChange={() => void setTheme(id)}
                    className="sr-only"
                  />
                  <span
                    data-theme={id}
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 overflow-hidden rounded border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)]"
                  >
                    <span className="h-full w-1.5 border-r border-[var(--color-app-border)] bg-[var(--color-app-bg)]" />
                  </span>
                  <span className="flex-1">{t(THEME_LABEL_KEY[id])}</span>
                  {theme === id && (
                    <Check
                      aria-hidden
                      isAnimated={false}
                      className="h-3.5 w-3.5 text-[var(--color-app-fg)]"
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        </PopoverContent>
      </Popover>
    </div>
  );
}
