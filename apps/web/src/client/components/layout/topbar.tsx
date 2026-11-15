import { useLocation } from 'react-router-dom';
import type { MeUser } from '../../lib/types';
import { useI18n } from '../../lib/i18n';
import { hidesBottomNav } from '../../lib/mobile-nav';
import { NAV, isNavItemActive } from './sidebar-nav';
import { useIsDesktop } from '../../lib/use-media-query';
import { MobileBackButton } from './mobile-back-button';
import { MobileMenuButton } from './mobile-menu-button';
import { AppearanceMenu } from './appearance-menu';
import { AccountMenu } from './account-menu';

interface TopbarProps {
  user: MeUser;
  showBack: boolean;
  showMobileMenu: boolean;
  onOpenMobileNav: () => void;
}

/** Phone chrome keeps its existing navigation and safe-area space. */
export function Topbar({
  user,
  showBack,
  showMobileMenu,
  onOpenMobileNav,
}: TopbarProps): React.ReactElement | null {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const { t } = useI18n();
  if (isDesktop) return null;
  const mobileUserMenuNeeded = hidesBottomNav(location.pathname, false);
  const activeItem = NAV.filter((item) => isNavItemActive(location.pathname, item.to)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  const sectionLabel = activeItem
    ? t(activeItem.labelKey)
    : location.pathname.startsWith('/novidades')
      ? t('novidades.title')
      : t('shell.knowledgeBase');
  return (
    <header
      data-app-header
      className="relative z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-3 border-b border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-3 pt-[env(safe-area-inset-top)]"
    >
      <div className="flex min-w-0 items-center gap-3">
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
        {mobileUserMenuNeeded && (
          <div className="border-l border-[var(--color-app-border)] pl-2 sm:pl-3">
            <AccountMenu user={user} />
          </div>
        )}
      </div>
    </header>
  );
}
