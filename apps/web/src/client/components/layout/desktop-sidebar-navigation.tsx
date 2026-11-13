import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PanelLeftClose, Plus } from '@/components/ui/icons';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Logo } from '../ui/logo';
import type { MeUser } from '../../lib/types';
import { useI18n } from '../../lib/i18n';
import { NAV, NAV_SCOPES, NAV_SCOPE_LABELS, isNavItemActive } from './sidebar-nav';
import { WorkspaceLink } from './workspace-link';

export function DesktopSidebarNavigation({
  user,
  onCollapse,
  footer,
}: {
  user: MeUser;
  onCollapse: () => void;
  footer: ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const items = NAV.filter((item) => !item.adminOnly || user.role === 'ADMIN');

  return (
    <SideNav
      className="desktop-navigation"
      aria-label={t('shell.knowledgeBase')}
      header={
        <div className="desktop-brand-row">
          <WorkspaceLink href="/transcricoes" className="desktop-brand-link" aria-label="Voxen">
            <Logo size={40} withWordmark={false} />
            <span className="min-w-0">
              <span className="block font-display text-[22px] font-semibold tracking-tight">
                Voxen
              </span>
              <span className="block text-xs text-[var(--color-app-muted)]">
                {t('shell.knowledgeBase')}
              </span>
            </span>
          </WorkspaceLink>
          <IconButton
            id="desktop-sidebar-close"
            label={t('shell.collapse')}
            tooltipSide="right"
            onClick={onCollapse}
            className="h-8 w-8 shrink-0 rounded-lg"
          >
            <PanelLeftClose className="h-4 w-4" />
          </IconButton>
        </div>
      }
      topContent={
        <Button variant="primary" asChild className="w-full justify-start gap-2.5">
          <WorkspaceLink href="/capturar">
            <Plus className="h-4 w-4" />
            {t('capture.new')}
          </WorkspaceLink>
        </Button>
      }
      footer={<div className="desktop-nav-footer">{footer}</div>}
    >
      {NAV_SCOPES.map((scope) => {
        const destinations = items.filter((item) => item.scope === scope);
        if (destinations.length === 0) return null;
        return (
          <SideNavSection
            key={scope}
            title={t(NAV_SCOPE_LABELS[scope])}
            className="desktop-nav-section"
          >
            {destinations.map(({ to, labelKey, Icon }) => (
              <SideNavItem
                key={to}
                as={WorkspaceLink}
                href={to}
                label={t(labelKey)}
                icon={<Icon className="h-[18px] w-[18px]" />}
                isSelected={isNavItemActive(pathname, to)}
                className="desktop-nav-item"
              />
            ))}
          </SideNavSection>
        );
      })}
    </SideNav>
  );
}
