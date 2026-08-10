import { Check, LoaderCircle } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';
import type { PendingHitl } from '../../lib/chat-tools';

export function HitlConfirmBar({
  pending,
  approving,
  onApprove,
}: {
  pending: PendingHitl[];
  approving: ReadonlySet<string>;
  onApprove: (id: string, options?: { alwaysAllow?: boolean }) => void;
}): React.ReactElement | null {
  const { t } = useI18n();
  if (pending.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-2" role="region" aria-label={t('chat.hitlRegion')}>
      {pending.map((item) => {
        const busy = approving.has(item.approvalId);
        const operationLabel = item.patchPreview
          ? {
              replace: t('chat.hitlPatchOperation.replace'),
              insert_before: t('chat.hitlPatchOperation.insertBefore'),
              insert_after: t('chat.hitlPatchOperation.insertAfter'),
              prepend: t('chat.hitlPatchOperation.prepend'),
              append: t('chat.hitlPatchOperation.append'),
            }[item.patchPreview.operationKind]
          : null;
        return (
          <div
            key={item.approvalId}
            className="flex flex-col gap-2 rounded-xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 px-3 py-2.5"
          >
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--color-app-fg)]">
                  {item.action === 'patch_note' && item.title
                    ? t('chat.hitlProposePatch', { title: item.title })
                    : item.title
                      ? t('chat.hitlProposeNote', { title: item.title })
                      : t('chat.confirmationTitle')}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                  {item.action === 'patch_note'
                    ? t('chat.hitlPatchHint')
                    : t('chat.hitlConfirmHint')}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {item.action !== 'patch_note' ? (
                  <button
                    type="button"
                    onClick={() => onApprove(item.approvalId, { alwaysAllow: true })}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-accent-amber)]/40 bg-transparent px-2.5 py-1.5 text-xs font-medium text-[var(--color-app-fg)] hover:bg-[var(--color-accent-amber)]/15 disabled:cursor-wait disabled:opacity-60"
                  >
                    {t('chat.hitlAlwaysAllow')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onApprove(item.approvalId)}
                  disabled={busy || (item.action === 'patch_note' && !item.patchPreview)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-amber)] px-3 py-1.5 text-xs font-semibold text-[var(--color-app-bg)] hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                  {busy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}{' '}
                  {t('chat.confirm')}
                </button>
              </div>
            </div>
            {item.action === 'patch_note' && item.patchPreview ? (
              <div className="grid gap-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/70 p-2.5 text-[11px] sm:grid-cols-2">
                <p className="sm:col-span-2 text-[var(--color-app-muted)]">
                  <span className="font-semibold text-[var(--color-app-fg)]">
                    {operationLabel}
                    {item.patchPreview.occurrence
                      ? ` · ${t('chat.hitlPatchOccurrence', { occurrence: item.patchPreview.occurrence })}`
                      : ''}
                  </span>{' '}
                  · {t('chat.hitlPatchLine', { line: item.patchPreview.line })} ·{' '}
                  {item.patchPreview.changeSummary}
                </p>
                {item.patchPreview.target ? (
                  <div className="min-w-0">
                    <p className="mb-1 font-semibold text-rose-300">{t('chat.hitlPatchTarget')}</p>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-rose-500/10 p-2 text-[10px] leading-relaxed text-[var(--color-app-fg)]">
                      {item.patchPreview.target}
                      {item.patchPreview.truncatedTarget ? '…' : ''}
                    </pre>
                  </div>
                ) : null}
                <div className="min-w-0">
                  <p className="mb-1 font-semibold text-emerald-300">
                    {t('chat.hitlPatchReplacement')}
                  </p>
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-emerald-500/10 p-2 text-[10px] leading-relaxed text-[var(--color-app-fg)]">
                    {item.patchPreview.replacement}
                    {item.patchPreview.truncatedReplacement ? '…' : ''}
                  </pre>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <p className="mb-1 font-semibold text-[var(--color-app-muted)]">
                    {t('chat.hitlPatchResult')}
                  </p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-app-border)] p-2 text-[10px] leading-relaxed text-[var(--color-app-muted)]">
                    {item.patchPreview.context}
                    {item.patchPreview.truncatedContext ? '…' : ''}
                  </pre>
                </div>
              </div>
            ) : item.action === 'patch_note' ? (
              <p className="text-[11px] font-medium text-rose-300">
                {t('chat.hitlPatchPreviewUnavailable')}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
