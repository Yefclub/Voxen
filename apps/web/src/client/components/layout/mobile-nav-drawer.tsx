import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LayoutGroup,
  animate,
  motion,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { X } from '@/components/ui/icons';
import type { MeUser } from '../../lib/types';
import { useI18n } from '../../lib/i18n';
import {
  drawerPanelOpacity,
  drawerPanelShadow,
  drawerPanelVisibility,
} from '../../lib/use-edge-swipe';
import { SidebarModeBody, SidebarSignOut, SidebarChangelogButton } from './sidebar';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Navegação mobile persistente: fica preparada fora da tela e acompanha o
 * MotionValue alimentado pelo gesto global, evitando montar a árvore inteira
 * somente depois que o usuário termina o swipe.
 */
export function MobileNavDrawer({
  user,
  open,
  progress,
  onClose,
}: {
  user: MeUser;
  open: boolean;
  progress: MotionValue<number>;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const location = useLocation();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const panelX = useTransform(progress, (value) => `${(value - 1) * 100}%`);
  const backdropOpacity = useTransform(progress, [0, 1], [0, 0.68]);
  const panelOpacity = useTransform(progress, drawerPanelOpacity);
  const panelShadow = useTransform(progress, drawerPanelShadow);
  const panelVisibility = useTransform(progress, drawerPanelVisibility);

  useEffect(() => {
    const controls = animate(progress, open ? 1 : 0, {
      duration: reduceMotion ? 0 : 0.22,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [open, progress, reduceMotion]);

  const pathRef = useRef(location.pathname);
  useEffect(() => {
    if (pathRef.current === location.pathname) return;
    pathRef.current = location.pathname;
    onClose();
  }, [location.pathname, onClose]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => panelRef.current?.focus());
    }
    if (!open && wasOpenRef.current) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  return (
    <>
      <motion.div
        className={[
          'fixed inset-0 z-50 bg-black md:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
        style={{ opacity: backdropOpacity }}
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.menu')}
        aria-hidden={!open}
        inert={open ? undefined : true}
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-[22rem] flex-col overflow-hidden',
          'border-r border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]',
          'focus:outline-none will-change-transform md:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
        style={{
          x: panelX,
          opacity: panelOpacity,
          boxShadow: panelShadow,
          visibility: panelVisibility,
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex h-16 shrink-0 items-center border-b border-[var(--color-app-border)] px-4">
          <div className="relative h-9 w-9 shrink-0">
            <img
              src="/voxen-256.png"
              alt="Voxen"
              width={36}
              height={36}
              draggable={false}
              className="pointer-events-none select-none rounded-lg"
            />
          </div>
          <div className="ml-3 flex min-w-0 flex-col leading-none">
            <span className="font-display text-sm font-semibold tracking-tight">Voxen</span>
            <span className="mt-1 whitespace-nowrap text-[9px] uppercase tracking-[0.04em] text-[var(--color-app-muted)]">
              {t('shell.knowledgeBase')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]"
            aria-label={t('shell.closeMenu')}
            title={t('shell.closeMenu')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <LayoutGroup id="mobile-nav">
          <SidebarModeBody user={user} hideHome />
        </LayoutGroup>
        <SidebarChangelogButton />
        <SidebarSignOut />
      </motion.aside>
    </>
  );
}
