import { NavLink, Outlet } from 'react-router-dom';
import { DollarSign, Plug, Settings, ShieldCheck, Users } from '@/components/ui/icons';
import { useI18n, type I18nKey } from '../../lib/i18n';
import { cn } from '../../lib/utils';

const ADMIN_NAV = [
  { to: '/admin/configuracao', labelKey: 'admin.shell.configuration', Icon: Settings },
  { to: '/admin/integracoes', labelKey: 'admin.shell.integrations', Icon: Plug },
  { to: '/admin/usuarios', labelKey: 'admin.shell.users', Icon: Users },
  { to: '/admin/custos', labelKey: 'admin.shell.costs', Icon: DollarSign },
] satisfies { to: string; labelKey: I18nKey; Icon: typeof Settings }[];

/** Shared shell that keeps instance-wide controls visibly separate from user work. */
export function AdminLayout(): React.ReactElement {
  const { t } = useI18n();

  return (
    <div className="min-h-full">
      <header className="mx-auto mb-7 w-full max-w-[1600px] px-4 sm:px-7 xl:px-10">
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.045] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-300">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-base font-semibold text-[var(--color-app-fg)]">
                {t('admin.shell.title')}
              </h1>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--color-app-muted)]">
                {t('admin.shell.description')}
              </p>
            </div>
          </div>
          <nav
            className="mt-4 flex gap-1 overflow-x-auto border-t border-violet-500/15 pt-3"
            aria-label={t('admin.shell.title')}
          >
            {ADMIN_NAV.map(({ to, labelKey, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-violet-500/15 text-violet-200'
                      : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]',
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
