import { NavLink, useLocation } from 'react-router-dom';
import { ListVideo, MessagesSquare, Network, PlayCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useI18n, type I18nKey } from '../../lib/i18n';

interface MobileNavItem {
  to: string;
  labelKey: I18nKey;
  Icon: typeof MessagesSquare;
}

const ITEMS: MobileNavItem[] = [
  { to: '/chat', labelKey: 'shell.nav.chat', Icon: MessagesSquare },
  { to: '/jobs', labelKey: 'shell.nav.jobs', Icon: PlayCircle },
  { to: '/transcricoes', labelKey: 'shell.nav.library', Icon: ListVideo },
  { to: '/grafo', labelKey: 'shell.nav.graph', Icon: Network },
];

export function MobileBottomNav(): React.ReactElement {
  const location = useLocation();
  const { t } = useI18n();

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-app-border)] bg-[var(--color-app-bg)]/95 backdrop-blur-xl"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0px)' }}
      aria-label={t('shell.menu')}
    >
      <div className="grid h-16 grid-cols-4 px-2">
        {ITEMS.map(({ to, labelKey, Icon }) => {
          const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition-colors',
                active ? 'text-emerald-300' : 'text-[var(--color-app-muted)] active:text-zinc-100',
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
      </div>
    </nav>
  );
}
