import { AlertTriangle, RotateCw } from '@/components/ui/icons';
import { Button } from './button';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

/**
 * Bloco de erro de fetch com retry — substitui o empty state enganoso quando um
 * GET falha (rede/servidor). Padrão rico: ícone + título + mensagem + ação de
 * tentar novamente. Usa o `error`/`refresh` do useFetch.
 */
export function FetchError({
  message,
  onRetry,
  retrying = false,
  className,
}: {
  message?: string | null;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn('flex items-center justify-center px-6 py-12', className)}
    >
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)]">
          <AlertTriangle className="h-5 w-5 text-rose-400" />
        </div>
        <div className="space-y-1.5">
          <p className="font-display text-lg font-semibold text-[var(--color-app-fg)]">
            {t('common.fetchErrorTitle')}
          </p>
          <p className="text-sm leading-relaxed text-[var(--color-app-muted)] break-words">
            {message || t('common.error')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RotateCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} />
          {t('common.fetchErrorRetry')}
        </Button>
      </div>
    </div>
  );
}
