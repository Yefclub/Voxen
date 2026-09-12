import type { NavigateFunction } from 'react-router-dom';
import { Globe, PlayCircle } from '@/components/ui/icons';
import type { BatchIngestItem } from '../../lib/batch-ingest';
import type { DetectedSource } from '../../lib/source-detect';
import type { TranslateFn } from '../../lib/i18n';

export function BatchResultList({
  items,
  navigate,
  t,
}: {
  items: BatchIngestItem[];
  navigate: NavigateFunction;
  t: TranslateFn;
}): React.ReactElement {
  return (
    <ol className="space-y-1.5 pt-1" aria-live="polite">
      {items.map((item) => {
        const label = t(`jobs.batch.${item.result.outcome}`);
        const destination = item.result.jobId
          ? `/jobs/${item.result.jobId}`
          : item.result.transcriptId
            ? `/transcricoes/${item.result.transcriptId}`
            : null;
        return (
          <li
            key={`${item.index}:${item.input}`}
            className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-3 py-2 text-xs"
          >
            <span className="truncate font-mono text-[var(--color-app-muted)]">{item.input}</span>
            {destination ? (
              <button
                type="button"
                className="shrink-0 font-medium text-[var(--color-accent-primary)] hover:underline"
                onClick={() => navigate(destination)}
              >
                {label}
              </button>
            ) : (
              <span className="shrink-0 text-[var(--color-app-muted)]" title={item.result.error}>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function DetectedBadge({
  source,
  t,
}: {
  source: DetectedSource;
  t: TranslateFn;
}): React.ReactElement {
  const map = {
    YOUTUBE: {
      label: t('jobs.detect.youtube'),
      cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
    },
    INSTAGRAM: {
      label: t('jobs.detect.instagram'),
      cls: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
    },
    TIKTOK: {
      label: t('jobs.detect.tiktok'),
      cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    },
    X: { label: t('jobs.detect.x'), cls: 'text-sky-300 border-sky-500/40 bg-sky-500/10' },
    WEB: {
      label: t('jobs.detect.web'),
      cls: 'text-[var(--color-app-subtle)] border-zinc-500/40 bg-zinc-500/10',
    },
  } as const;
  const { label, cls } = map[source];
  const Icon = source === 'WEB' ? Globe : PlayCircle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium ${cls}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
