import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { apiPost, apiPut } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

type TranscriptPreference = 'MORE' | 'LESS' | 'NONE';

interface TranscriptInterestResponse {
  preference: TranscriptPreference;
  updatedAt: string | null;
}

export function TranscriptInterestFeedback({
  transcriptId,
}: {
  transcriptId: string;
}): React.ReactElement {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useFetch<TranscriptInterestResponse>(
    `/api/transcripts/${transcriptId}/interest`,
  );
  const [confirmed, setConfirmed] = useState<TranscriptPreference>('NONE');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Exclude<TranscriptPreference, 'NONE'> | null>(null);

  useEffect(() => {
    if (data) setConfirmed(data.preference);
  }, [data]);

  useEffect(() => {
    setConfirmed('NONE');
    setPending(null);
  }, [transcriptId]);

  useEffect(() => {
    void apiPost(`/api/transcripts/${transcriptId}/interest/view`).catch(() => undefined);
  }, [transcriptId]);

  async function choose(preference: Exclude<TranscriptPreference, 'NONE'>): Promise<void> {
    if (saving || loading || error) return;
    setSaving(true);
    setPending(preference);
    try {
      const state = await apiPut<TranscriptInterestResponse>(
        `/api/transcripts/${transcriptId}/interest`,
        { preference },
      );
      setConfirmed(state.preference);
    } catch {
      toast.error(t('library.interest.saveError'));
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  return (
    <Card
      elevated
      className="order-3 border-[var(--color-app-border)]/80 lg:order-none"
      data-testid="transcript-interest-feedback"
    >
      <CardContent className="space-y-4 pb-5 pt-5">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-app-fg)]">
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--color-accent-primary)]" />
            {t('library.interest.title')}
          </h2>
          <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
            {t('library.interest.description')}
          </p>
        </div>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
            <p className="text-xs text-[var(--color-app-danger)]">
              {t('library.interest.loadError')}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={refresh}>
              {t('library.interest.retry')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(['MORE', 'LESS'] as const).map((preference) => {
              const selected = confirmed === preference;
              const label = t(
                preference === 'MORE' ? 'library.interest.more' : 'library.interest.less',
              );
              return (
                <Button
                  key={preference}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={selected}
                  aria-label={`${label}. ${t(
                    selected
                      ? 'library.interest.clearHint'
                      : preference === 'MORE'
                        ? 'library.interest.moreHint'
                        : 'library.interest.lessHint',
                  )}`}
                  disabled={loading || saving}
                  onClick={() => void choose(preference)}
                  className={cn(
                    'min-h-9 flex-auto justify-center',
                    selected &&
                      'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary-soft)] text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary-soft)]',
                  )}
                >
                  {saving && pending === preference ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : null}
                  {label}
                </Button>
              );
            })}
          </div>
        )}

        {!error && confirmed !== 'NONE' ? (
          <p className="text-xs text-[var(--color-app-muted)]" aria-live="polite">
            {t('library.interest.selected')} · {t('library.interest.clearHint')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
