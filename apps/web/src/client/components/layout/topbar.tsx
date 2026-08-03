import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  Eraser,
  LoaderCircle,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  User as UserIcon,
  Volume2,
  VolumeX,
} from '@/components/ui/icons';
import { play } from 'cuelume';
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
import { APP_THEMES, type AppTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { hidesBottomNav, isChatRoute } from '../../lib/mobile-nav';
import { requestClearConversation, setSounds, useChatShell } from '../../lib/chat-shell-state';

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

/** Same comfortable 40×40 chrome target as MobileMenuButton on mobile. */
const chromeControlClass =
  'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/75 text-[var(--color-app-muted)] shadow-sm shadow-black/10 backdrop-blur-md transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] md:h-9 md:w-9 md:rounded-lg md:bg-transparent md:shadow-none md:backdrop-blur-none';

/**
 * Cabeçalho do shell — no mobile os controles flutuam individuais e
 * transparentes (histórico passa por baixo); no desktop mantém o pill.
 */
export function Topbar({ user }: { user: MeUser }): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useMe();
  const { t } = useI18n();
  const { theme, setTheme, toggleAppearance } = useTheme();
  const inChat = isChatRoute(location.pathname);
  const mobileUserMenuNeeded = hidesBottomNav(location.pathname, false);
  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  return (
    <header
      className={cn(
        'fixed right-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 flex items-center gap-1.5 border-0 bg-transparent p-0 shadow-none backdrop-blur-none',
        'md:right-4 md:top-[calc(env(safe-area-inset-top)+1rem)] md:gap-3 md:rounded-2xl md:border md:border-[var(--color-app-border)] md:bg-[var(--color-app-bg-elevated)]/85 md:px-2.5 md:py-2 md:backdrop-blur-xl',
      )}
    >
      {inChat && <ChatShellControls />}

      <button
        type="button"
        onClick={() => void toggleAppearance()}
        className={chromeControlClass}
        aria-label={theme === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}
        title={theme === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}
      >
        {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              chromeControlClass,
              'overflow-hidden p-0 ring-offset-2 ring-offset-[var(--color-app-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 md:rounded-full',
              !mobileUserMenuNeeded && 'max-md:hidden',
            )}
            aria-label={t('shell.userMenu')}
          >
            <Avatar className="h-8 w-8 bg-gradient-to-br from-emerald-500/30 to-violet-500/30 md:h-9 md:w-9">
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
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-[var(--color-app-muted)] font-medium py-1.5">
            {t('theme.label')}
          </DropdownMenuLabel>
          {APP_THEMES.map((id) => (
            <DropdownMenuItem
              key={id}
              onSelect={(event) => {
                event.preventDefault();
                void setTheme(id);
              }}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5',
                  theme === id ? 'opacity-100 text-[var(--color-accent-primary)]' : 'opacity-0',
                )}
              />
              <span className="truncate">{t(THEME_LABEL_KEY[id])}</span>
            </DropdownMenuItem>
          ))}
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
    </header>
  );
}

function ChatShellControls(): React.ReactElement {
  const { t } = useI18n();
  const { soundsEnabled, streaming, isEmpty } = useChatShell();

  return (
    <div className="flex items-center gap-1.5 md:gap-2">
      {streaming && (
        <span className="hidden items-center gap-1.5 text-xs text-[var(--color-accent-primary)] md:inline-flex">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {t('chat.responding')}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          const next = !soundsEnabled;
          setSounds(next);
          if (next) play('success');
        }}
        className={chromeControlClass}
        aria-label={soundsEnabled ? t('chat.soundsOff') : t('chat.soundsOn')}
        title={soundsEnabled ? t('chat.soundsOff') : t('chat.soundsOn')}
      >
        {soundsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => requestClearConversation()}
        disabled={streaming || isEmpty}
        className={cn(chromeControlClass, 'disabled:cursor-not-allowed disabled:opacity-40')}
        aria-label={t('chat.clearConversation')}
        title={t('chat.clearConversation')}
      >
        <Eraser className="h-4 w-4" />
      </button>
    </div>
  );
}
