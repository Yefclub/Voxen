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
            <Sparkles className="h-4 w-4 text-violet-300" />
            {t('library.interest.title')}
          </h2>
          <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
            {t('library.interest.description')}
          </p>
        </div>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
            <p className="text-xs text-rose-300">{t('library.interest.loadError')}</p>
            <Button type="button" size="sm" variant="outline" onClick={refresh}>
              {t('library.interest.retry')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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
                    'min-h-9 justify-center',
                    selected &&
                      'border-violet-400/50 bg-violet-500/15 text-violet-100 hover:bg-violet-500/20',
                  )}
                >
                  {saving && pending === preference ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {label}
                </Button>
              );
            })}
          </div>
        )}

        {!error && confirmed !== 'NONE' ? (
          <p className="text-[11px] text-violet-200/80" aria-live="polite">
            {t('library.interest.selected')} · {t('library.interest.clearHint')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
