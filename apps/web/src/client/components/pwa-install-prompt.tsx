import { Download, Share, SquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_UNTIL_KEY = 'voxen.pwa-install-dismissed-until';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

function canPrompt(): boolean {
  try {
    return Number(window.localStorage.getItem(DISMISS_UNTIL_KEY) ?? '0') < Date.now();
  } catch {
    return true;
  }
}

/** Instalação nativa no Chromium e instrução equivalente para Safari iOS. */
export function PwaInstallPrompt({ enabled }: { enabled: boolean }): React.ReactElement | null {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<DeferredInstallPrompt | null>(null);
  const [open, setOpen] = useState(false);
  const [ios, setIos] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || !canPrompt()) return;
    if (isIos()) {
      setIos(true);
      return;
    }
    const capture = (event: Event): void => {
      event.preventDefault();
      setDeferred(event as DeferredInstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    if (ios || deferred) setOpen(true);
  }, [deferred, enabled, ios]);

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_MS));
    } catch {
      // A sessão atual já fecha o diálogo; storage indisponível só impede a deduplicação.
    }
    setOpen(false);
  };

  const install = async (): Promise<void> => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setOpen(false);
    } finally {
      setInstalling(false);
      setDeferred(null);
    }
  };

  if (!open || (!ios && !deferred)) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('pwa.installTitle')}</DialogTitle>
          <DialogDescription>
            {t(ios ? 'pwa.installIosDescription' : 'pwa.installDescription')}
          </DialogDescription>
        </DialogHeader>
        {ios && (
          <ol className="space-y-2 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-3 text-sm text-[var(--color-app-subtle)]">
            <li className="flex items-center gap-2">
              <Share className="h-4 w-4 shrink-0" />
              {t('pwa.installIosStepShare')}
            </li>
            <li className="flex items-center gap-2">
              <SquarePlus className="h-4 w-4 shrink-0" />
              {t('pwa.installIosStepAdd')}
            </li>
          </ol>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={dismiss}>
            {t('pwa.installLater')}
          </Button>
          {!ios && (
            <Button
              type="button"
              variant="primary"
              onClick={() => void install()}
              disabled={installing}
            >
              <Download className="h-4 w-4" />
              {t('pwa.installAction')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
