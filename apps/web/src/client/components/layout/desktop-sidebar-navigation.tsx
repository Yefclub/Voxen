import { useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Plus, Sparkles } from '@/components/ui/icons';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Logo } from '../ui/logo';
import type { MeUser } from '../../lib/types';
import { useI18n } from '../../lib/i18n';
import { NAV, NAV_SCOPES, NAV_SCOPE_LABELS, isNavItemActive } from './sidebar-nav';
import { WorkspaceLink } from './workspace-link';
import { AccountMenu } from './account-menu';
import { AppearanceMenu } from './appearance-menu';
import { SidebarReleaseUpdateButton } from './sidebar-release-update';
import { SidebarHeader, SidebarContent, SidebarFooter } from '../ui/sidebar';

export function DesktopSidebarNavigation({
  user,
  collapsed,
  onToggle,
}: {
  user: MeUser;
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const items = NAV.filter((item) => !item.adminOnly || user.role === 'ADMIN');
  return (
    <div className="desktop-navigation">
      <SidebarHeader className="desktop-nav-header">
        <div className="desktop-brand-row">
          <WorkspaceLink
            href="/transcricoes"
            className="desktop-brand-link"
            tabIndex={collapsed ? -1 : undefined}
            aria-hidden={collapsed || undefined}
          >
            <span aria-hidden="true">
              <Logo size={32} withWordmark={false} />
            </span>
            <span className="min-w-0">
              <span className="block font-heading text-lg font-semibold tracking-tight">Voxen</span>
              <span className="block text-xs text-[var(--color-app-muted)]">
                {t('shell.knowledgeBase')}
              </span>
            </span>
          </WorkspaceLink>
          <IconButton
            id={collapsed ? 'desktop-sidebar-open' : 'desktop-sidebar-close'}
            data-sidebar-toggle={collapsed ? '' : undefined}
            label={t(collapsed ? 'shell.expandSidebar' : 'shell.collapse')}
            aria-expanded={!collapsed}
            aria-controls="desktop-sidebar-navigation"
            tooltipSide="right"
            onClick={onToggle}
            className="h-11 w-11 shrink-0 rounded-lg"
          >
            {collapsed ? (
              <PanelLeftOpen isAnimated={false} className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose isAnimated={false} className="h-[18px] w-[18px]" />
            )}
          </IconButton>
        </div>
        <Button variant="primary" asChild className="desktop-new-capture">
          <WorkspaceLink
            href="/capturar"
            aria-label={t('capture.new')}
            title={collapsed ? t('capture.new') : undefined}
          >
            <Plus isAnimated={false} className="h-[18px] w-[18px] shrink-0" />
            <span aria-hidden={collapsed || undefined}>{t('capture.new')}</span>
          </WorkspaceLink>
        </Button>
      </SidebarHeader>
      <SidebarContent
        id="desktop-sidebar-navigation"
        aria-label={t('shell.knowledgeBase')}
        className="desktop-nav-content"
      >
        {NAV_SCOPES.map((scope) => {
          const destinations = items.filter((item) => item.scope === scope);
          if (!destinations.length) return null;
          return (
            <section
              key={scope}
              className="desktop-nav-section"
              aria-label={t(NAV_SCOPE_LABELS[scope])}
            >
              <h2 className="desktop-nav-label" aria-hidden={collapsed || undefined}>
                {t(NAV_SCOPE_LABELS[scope])}
              </h2>
              <ul>
                {destinations.map(({ to, labelKey, Icon }) => (
                  <li key={to}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <WorkspaceLink
                          href={to}
                          className="desktop-nav-item"
                          aria-current={isNavItemActive(pathname, to) ? 'page' : undefined}
                          aria-label={t(labelKey)}
                        >
                          <Icon isAnimated={false} className="h-[18px] w-[18px] shrink-0" />
                          <span className="truncate" aria-hidden={collapsed || undefined}>
                            {t(labelKey)}
                          </span>
                        </WorkspaceLink>
                      </TooltipTrigger>
                      {collapsed && <TooltipContent side="right">{t(labelKey)}</TooltipContent>}
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="desktop-nav-footer">
        {!collapsed && <SidebarReleaseUpdateButton />}
        <WorkspaceLink
          href="/novidades"
          className="desktop-nav-item"
          aria-label={t('shell.nav.changelog')}
          title={collapsed ? t('shell.nav.changelog') : undefined}
        >
          <Sparkles isAnimated={false} className="h-[18px] w-[18px] shrink-0" />
          <span aria-hidden={collapsed || undefined}>{t('shell.nav.changelog')}</span>
        </WorkspaceLink>
        <div className="desktop-appearance-row">
          {!collapsed && (
            <span className="text-xs text-[var(--color-app-muted)]">{t('theme.appearance')}</span>
          )}
          <AppearanceMenu compact={collapsed} />
        </div>
        <AccountMenu user={user} sidebar compact={collapsed} />
      </SidebarFooter>
    </div>
  );
}
