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
} from 'lucide-react';
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
import { isChatRoute } from '../../lib/mobile-nav';
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

const THEME_LABEL_KEY: Record<AppTheme, 'theme.zinc' | 'theme.emerald' | 'theme.light'> = {
  zinc: 'theme.zinc',
  emerald: 'theme.emerald',
  light: 'theme.light',
};

/**
 * Cabeçalho do shell — pill flutuante no canto superior direito, mesma
 * linguagem visual da sidebar (`fixed`, pill com blur). Aparece em
 * mobile e desktop agora (antes era desktop-only com uma barra full-width; a
 * navegação mobile passou a ter os mesmos controles do desktop, incluindo o
 * avatar — pequena redundância com a bottom-nav, mais simples que branch por
 * breakpoint). Hospeda o toggle de tema, os controles do chat (quando
 * aplicável) e o menu de usuário.
 */
export function Topbar({ user }: { user: MeUser }): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useMe();
  const { t } = useI18n();
  const { theme, setTheme, toggleAppearance } = useTheme();
  // Botões de chat (sons + limpar) só na rota de chat (`/` e `/chat`).
  const inChat = isChatRoute(location.pathname);
  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  return (
    <header className="fixed right-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 flex items-center gap-1 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/75 px-1.5 py-1.5 backdrop-blur-md md:right-4 md:top-[calc(env(safe-area-inset-top)+1rem)] md:gap-3 md:rounded-2xl md:bg-[var(--color-app-bg-elevated)]/85 md:px-2.5 md:py-2 md:backdrop-blur-xl">
      {inChat && <ChatShellControls />}

      <button
        type="button"
        onClick={() => void toggleAppearance()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border)] text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] md:h-9 md:w-9"
        aria-label={theme === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}
        title={theme === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}
      >
        {theme === 'light' ? (
          <Moon className="h-3.5 w-3.5 md:h-4 md:w-4" />
        ) : (
          <Sun className="h-3.5 w-3.5 md:h-4 md:w-4" />
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full ring-offset-2 ring-offset-[var(--color-app-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 hover:opacity-90 transition-opacity"
            aria-label={t('shell.userMenu')}
          >
            <Avatar className="h-8 w-8 bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-[var(--color-app-border-strong)] md:h-9 md:w-9">
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

/**
 * Controles do chat no cabeçalho global (só na rota de chat): som on/off e
 * limpar conversa. Leem/escrevem no store `chat-shell-state` — o `chat.tsx`
 * publica `streaming`/`isEmpty` e consome o pedido de limpar via signal.
 */
function ChatShellControls(): React.ReactElement {
  const { t } = useI18n();
  const { soundsEnabled, streaming, isEmpty } = useChatShell();

  return (
    <div className="flex items-center gap-1 md:gap-2">
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border)] text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] md:h-9 md:w-9"
        aria-label={soundsEnabled ? t('chat.soundsOff') : t('chat.soundsOn')}
        title={soundsEnabled ? t('chat.soundsOff') : t('chat.soundsOn')}
      >
        {soundsEnabled ? (
          <Volume2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
        ) : (
          <VolumeX className="h-3.5 w-3.5 md:h-4 md:w-4" />
        )}
      </button>
      <button
        type="button"
        onClick={() => requestClearConversation()}
        disabled={streaming || isEmpty}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-app-border)] text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] disabled:cursor-not-allowed disabled:opacity-40 md:h-9 md:w-9"
        aria-label={t('chat.clearConversation')}
        title={t('chat.clearConversation')}
      >
        <Eraser className="h-3.5 w-3.5 md:h-4 md:w-4" />
      </button>
    </div>
  );
}
