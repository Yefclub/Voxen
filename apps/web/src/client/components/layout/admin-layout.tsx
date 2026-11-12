import { NavLink, Outlet } from 'react-router-dom';
import { KeyRound, Plug, Settings, Users } from '@/components/ui/icons';
import { useI18n, type I18nKey } from '../../lib/i18n';
import { cn } from '../../lib/utils';

const ADMIN_NAV = [
  { to: '/admin/configuracao', labelKey: 'admin.shell.configuration', Icon: Settings },
  { to: '/admin/integracoes', labelKey: 'admin.shell.integrations', Icon: Plug },
  { to: '/admin/autenticacao', labelKey: 'admin.shell.authentication', Icon: KeyRound },
  { to: '/admin/usuarios', labelKey: 'admin.shell.users', Icon: Users },
] satisfies { to: string; labelKey: I18nKey; Icon: typeof Settings }[];

/** Shared shell that keeps instance-wide controls visibly separate from user work. */
export function AdminLayout(): React.ReactElement {
  const { t } = useI18n();

  return (
    <div className="min-h-full">
      <header className="mx-auto w-full max-w-[1600px] px-5 pt-6 sm:px-8 sm:pt-8 xl:px-10">
        <nav
          className="grid grid-cols-2 gap-1 border-b border-[var(--color-app-border)] pb-3 sm:flex sm:flex-wrap"
          aria-label={t('admin.shell.title')}
        >
          {ADMIN_NAV.map(({ to, labelKey, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--color-accent-primary-soft)] text-[var(--color-accent-primary)]'
                    : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
