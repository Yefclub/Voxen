import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useIsCoarsePointer, useMediaQuery } from '../lib/use-media-query';
import { useI18n } from '../lib/i18n';
import { Logo } from './ui/logo';

type LockableOrientation = ScreenOrientation & { lock?: (mode: string) => Promise<void> };

function isPhone(coarse: boolean): boolean {
  return coarse && Math.min(window.screen.width, window.screen.height) < 600;
}

/** Physical screen orientation is unaffected by the portrait software keyboard. */
function isLandscapePhone(coarse: boolean): boolean {
  if (!isPhone(coarse)) return false;
  const type = window.screen.orientation?.type;
  if (type) return type.startsWith('landscape');
  const angle = (window as Window & { orientation?: number }).orientation;
  if (typeof angle === 'number') return Math.abs(angle) === 90;
  return window.screen.width > window.screen.height;
}

export function MobilePortraitBoundary({ children }: { children: ReactNode }): React.ReactElement {
  const coarse = useIsCoarsePointer();
  const standalone = useMediaQuery('(display-mode: standalone)');
  const { t } = useI18n();
  const [blocked, setBlocked] = useState(() => isLandscapePhone(coarse));
  const blockedRef = useRef(blocked);
  const previousFocus = useRef<HTMLElement | null>(null);
  const instruction = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const sync = (): void => {
      const next = isLandscapePhone(coarse);
      if (next && !blockedRef.current && document.activeElement instanceof HTMLElement) {
        previousFocus.current = document.activeElement;
      }
      blockedRef.current = next;
      setBlocked(next);
    };
    sync();
    const orientation = window.screen.orientation;
    orientation?.addEventListener('change', sync);
    window.addEventListener('orientationchange', sync);
    window.addEventListener('resize', sync);
    return () => {
      orientation?.removeEventListener('change', sync);
      window.removeEventListener('orientationchange', sync);
      window.removeEventListener('resize', sync);
    };
  }, [coarse]);

  useEffect(() => {
    const installed = standalone || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (!installed || !isPhone(coarse)) return;
    const orientation = window.screen.orientation as LockableOrientation | undefined;
    if (typeof orientation?.lock !== 'function') return;
    // Fullscreen-only and unavailable platform APIs use the visible portrait guard.
    try {
      void orientation.lock('portrait').catch(() => undefined);
    } catch {
      // A synchronous platform rejection uses the same visible fallback.
    }
  }, [coarse, standalone]);

  return (
    <>
      <div
        className="contents"
        data-portrait-content
        inert={blocked || undefined}
        aria-hidden={blocked || undefined}
      >
        {children}
      </div>
      <Dialog.Root open={blocked}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[10000] bg-[var(--color-app-bg)]" />
          <Dialog.Content
            ref={instruction}
            role="alertdialog"
            tabIndex={-1}
            className="fixed inset-0 z-[10001] flex flex-col items-center justify-center gap-4 overflow-y-auto bg-[var(--color-app-bg)] px-6 py-[max(1.5rem,env(safe-area-inset-top))] text-center text-[var(--color-app-fg)] outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              instruction.current?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (previousFocus.current?.isConnected)
                previousFocus.current.focus({ preventScroll: true });
              previousFocus.current = null;
            }}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <Logo size={48} withWordmark={false} />
            <Dialog.Title className="font-display text-2xl font-semibold tracking-tight">
              {t('design.portraitTitle')}
            </Dialog.Title>
            <Dialog.Description className="max-w-sm text-sm leading-relaxed text-[var(--color-app-muted)]">
              {t('design.portraitDescription')}
            </Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
