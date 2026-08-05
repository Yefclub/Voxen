import { KeyRound, Link2, User as UserIcon } from '@/components/ui/icons';
import { NavLink } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

const accountSections = [
  { to: '/conta', label: 'account.title', icon: UserIcon, end: true },
  { to: '/conta/plataformas', label: 'account.platforms.title', icon: Link2, end: false },
  { to: '/conta/mcp', label: 'account.mcp.title', icon: KeyRound, end: false },
] as const;

export function AccountPageNav(): React.ReactElement {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t('account.eyebrow')}
      className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
    >
      <div className="flex min-w-max gap-2">
        {accountSections.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-[var(--color-accent-violet)]/40 bg-[var(--color-accent-violet-soft)] text-[var(--color-app-fg)]'
                  : 'border-[var(--color-app-border)] bg-[var(--color-app-surface)] text-[var(--color-app-muted)] hover:border-[var(--color-app-border-strong)] hover:text-[var(--color-app-fg)]',
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {t(label)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
