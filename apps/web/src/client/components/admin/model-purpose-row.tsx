import { RotateCcw, Trash2 } from '@/components/ui/icons';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { useI18n } from '../../lib/i18n';
import type { ModelPurposeStatus } from '../../lib/types';
import { cn } from '../../lib/utils';

interface AdminModelPurposeRowProps {
  status: ModelPurposeStatus;
  label: string;
  disabled: boolean;
  resetting: boolean;
  clearingFallback: boolean;
  onChange: () => void;
  onChangeFallback: () => void;
  onClearFallback: () => void;
  onReset: () => void;
}

export function AdminModelPurposeRow({
  status,
  label,
  disabled,
  resetting,
  clearingFallback,
  onChange,
  onChangeFallback,
  onClearFallback,
  onReset,
}: AdminModelPurposeRowProps): React.ReactElement {
  const { t } = useI18n();
  const hasOverride = status.override !== null;

  return (
    <div className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/40 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--color-app-fg)]">{label}</p>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              hasOverride
                ? 'bg-violet-500/15 text-violet-300'
                : 'bg-[var(--color-app-surface)] text-[var(--color-app-muted)]',
            )}
          >
            {hasOverride
              ? t('admin.integrations.models.overrideBadge')
              : t('admin.integrations.models.canonicalBadge')}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-app-fg)]">
          {status.effective}
        </p>
        <p className="text-[11px] text-[var(--color-app-muted)]">
          {hasOverride
            ? t('admin.integrations.models.canonicalHint', { model: status.canonical })
            : t('admin.integrations.models.usingCanonical')}
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-app-muted)]">
          Fallback: {status.fallback ?? t('admin.users.status.disabled')}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onChange} disabled={disabled}>
          {t('admin.integrations.models.change')}
        </Button>
        {hasOverride && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled || resetting}>
            {resetting ? <Spinner /> : <RotateCcw className="h-3.5 w-3.5" />}
            {t('admin.integrations.models.reset')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onChangeFallback} disabled={disabled}>
          {t('admin.integrations.models.changeFallback')}
        </Button>
        {status.fallback && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFallback}
            disabled={disabled || clearingFallback}
          >
            {clearingFallback ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
            {t('admin.integrations.models.clearFallback')}
          </Button>
        )}
      </div>
    </div>
  );
}
