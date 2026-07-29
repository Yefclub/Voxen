import { RefreshCw, WifiOff } from '@/components/ui/icons';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '../lib/i18n';

/**
 * Falha de rede ao consultar /api/me não significa que a sessão terminou.
 * Este estado evita redirecionar um PWA instalado para login por engano.
 */
export function SessionUnavailable({
  onRetry,
}: {
  onRetry: () => void | Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    const sync = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-app-bg)] px-5 text-center">
      <div className="max-w-sm space-y-4">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] text-[var(--color-app-muted)]">
          <WifiOff className="h-5 w-5" />
        </span>
        <div className="space-y-1.5">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-app-fg)]">
            {online ? t('shell.sessionUnavailableTitle') : t('shell.offlineTitle')}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--color-app-muted)]">
            {online ? t('shell.sessionUnavailableDescription') : t('shell.offlineDescription')}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void onRetry()}>
          <RefreshCw className="h-4 w-4" />
          {t('common.fetchErrorRetry')}
        </Button>
      </div>
    </div>
  );
}
