import { Layers3 } from '@/components/ui/icons';
import type { GraphIndexVisualState } from '../lib/graph-loading';
import type { TranslateFn } from '../lib/i18n';
import { Button } from './ui/button';

const BADGE_STYLES: Record<GraphIndexVisualState, string> = {
  indexing: 'border-amber-400/25 bg-amber-400/10',
  deferred: 'border-amber-400/25 bg-amber-400/10',
  failed: 'border-rose-400/25 bg-rose-400/10',
  ready: 'border-emerald-400/20 bg-emerald-400/10',
};

const DOT_STYLES: Record<GraphIndexVisualState, string> = {
  indexing: 'animate-pulse bg-amber-400',
  deferred: 'bg-amber-400',
  failed: 'bg-rose-400',
  ready: 'bg-emerald-400',
};

const LABEL_KEYS: Record<GraphIndexVisualState, Parameters<TranslateFn>[0]> = {
  indexing: 'graph.indexing',
  deferred: 'graph.indexDeferred',
  failed: 'graph.indexError',
  ready: 'graph.ready',
};

export function GraphIndexStatusBadge({
  state,
  translate,
}: {
  state: GraphIndexVisualState | null;
  translate: TranslateFn;
}) {
  if (!state) return null;
  return (
    <span
      role={state === 'deferred' ? undefined : 'status'}
      aria-live={state === 'deferred' ? undefined : 'polite'}
      className={`${state === 'ready' ? 'hidden sm:inline-flex' : 'inline-flex'} items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium text-[var(--color-app-fg)] ${BADGE_STYLES[state]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[state]}`} />
      {translate(LABEL_KEYS[state])}
    </span>
  );
}

export function GraphIndexDeferredState({
  translate,
  onRetry,
}: {
  translate: TranslateFn;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
      <div className="max-w-sm rounded-2xl border border-amber-400/20 bg-[var(--color-app-bg-elevated)]/95 p-6 text-center shadow-xl backdrop-blur-xl">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10 text-[var(--color-app-fg)]"
        >
          <Layers3 className="h-5 w-5" />
        </div>
        <div role="status" aria-live="polite">
          <p className="font-display text-sm font-semibold">
            {translate('graph.indexDeferredTitle')}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-app-muted)]">
            {translate('graph.indexDeferredDescription')}
          </p>
        </div>
        <Button className="mt-4" onClick={onRetry}>
          {translate('graph.retryIndex')}
        </Button>
      </div>
    </div>
  );
}
