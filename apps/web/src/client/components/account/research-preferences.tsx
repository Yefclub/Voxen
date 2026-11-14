import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { FetchError } from '../ui/fetch-error';
import { apiPut } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import {
  researchErrorText,
  type ResearchMode,
  type ResearchPreferences,
} from '../../lib/research-api';

export function ResearchPreferencesSection(): React.ReactElement {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useFetch<ResearchPreferences>(
    '/api/research/preferences',
  );
  const [draftMode, setDraftMode] = useState<ResearchMode | null>(null);
  const [key, setKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const mode = draftMode ?? data?.mode ?? 'OFF';
  const changed = Boolean(data && (mode !== data.mode || key.trim() || removeKey));

  useEffect(() => {
    if (window.location.hash === '#library-research')
      document.getElementById('library-research')?.scrollIntoView({ block: 'start' });
  }, []);

  async function save() {
    if (busy || !data) return;
    setBusy(true);
    setFailed(false);
    setNotice(t('research.settings.saving'));
    try {
      await apiPut('/api/research/preferences', {
        mode,
        ...(removeKey ? { searchKey: null } : key.trim() ? { searchKey: key.trim() } : {}),
      });
      setDraftMode(mode);
      setKey('');
      setRemoveKey(false);
      setNotice(t('research.settings.saved'));
      refresh();
    } catch (error) {
      setFailed(true);
      setNotice(researchErrorText(error, t));
    } finally {
      setBusy(false);
    }
  }

  const descriptions = {
    OFF: 'research.settings.offDescription',
    MANUAL: 'research.settings.manualDescription',
    AUTO: 'research.settings.autoDescription',
  } as const;

  return (
    <section
      id="library-research"
      aria-labelledby="library-research-title"
      className="scroll-mt-8 space-y-5 border-t border-[var(--color-app-border)] pt-8"
    >
      <div className="max-w-[65ch] space-y-2">
        <h2
          id="library-research-title"
          className="font-display text-xl font-semibold tracking-tight text-[var(--color-app-fg)]"
        >
          {t('research.settings.title')}
        </h2>
        <p className="text-sm leading-6 text-[var(--color-app-muted)]">
          {t('research.settings.description')}
        </p>
      </div>
      {error && (
        <FetchError message={researchErrorText(error, t)} onRetry={refresh} retrying={loading} />
      )}
      {!data ? (
        !error && <Skeleton className="h-48 w-full rounded-xl" />
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="library-research-mode">{t('research.settings.mode')}</Label>
              <select
                id="library-research-mode"
                value={mode}
                onChange={(event) => {
                  setDraftMode(event.target.value as ResearchMode);
                  setNotice('');
                }}
                disabled={busy || removeKey}
                aria-describedby="library-research-mode-description"
                className="h-11 w-full rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 text-sm text-[var(--color-app-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] disabled:opacity-50"
              >
                <option value="OFF">{t('research.settings.off')}</option>
                <option value="MANUAL">{t('research.settings.manual')}</option>
                <option value="AUTO">{t('research.settings.auto')}</option>
              </select>
              <p
                id="library-research-mode-description"
                className="text-sm leading-6 text-[var(--color-app-muted)]"
              >
                {t(descriptions[mode])}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="library-research-key">{t('research.settings.key')}</Label>
              <Input
                id="library-research-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={key}
                minLength={8}
                maxLength={512}
                onChange={(event) => {
                  setKey(event.target.value);
                  setNotice('');
                }}
                disabled={busy || removeKey}
                placeholder={t(
                  data.searchConfigured
                    ? 'research.settings.keyReplace'
                    : 'research.settings.keyPlaceholder',
                )}
                aria-describedby="library-research-key-description"
                className="h-11"
              />
              {data.searchConfigured && (
                <p className="text-sm text-[var(--color-app-subtle)]">
                  {t('research.settings.configured', { last4: data.searchLast4 ?? '' })}
                </p>
              )}
              <p
                id="library-research-key-description"
                className="text-sm leading-6 text-[var(--color-app-muted)]"
              >
                {t('research.settings.shared')}
              </p>
            </div>
          </div>
          {data.searchConfigured && (
            <div className="max-w-[65ch]">
              <label
                htmlFor="library-research-remove-key"
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[var(--color-app-subtle)]"
              >
                <input
                  id="library-research-remove-key"
                  type="checkbox"
                  checked={removeKey}
                  disabled={busy}
                  onChange={(event) => {
                    setRemoveKey(event.target.checked);
                    setDraftMode(event.target.checked ? 'OFF' : null);
                    setNotice('');
                  }}
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--theme-focus)]"
                />
                {t('research.settings.remove')}
              </label>
              {removeKey && (
                <p className="text-sm leading-6 text-[var(--color-app-muted)]">
                  {t('research.settings.removeDescription')}
                </p>
              )}
            </div>
          )}
          <p className="max-w-[75ch] text-sm leading-6 text-[var(--color-app-muted)]">
            {t('research.settings.privacy')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!changed || busy}>
              {t(busy ? 'research.settings.saving' : 'research.settings.save')}
            </Button>
            {changed && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraftMode(null);
                  setKey('');
                  setRemoveKey(false);
                  setNotice('');
                }}
              >
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      )}
      <p
        role="status"
        aria-label={t('research.status')}
        aria-live="polite"
        aria-atomic="true"
        className={`min-h-5 text-sm ${failed ? 'text-[var(--color-app-danger)]' : 'text-[var(--color-app-muted)]'}`}
      >
        {notice}
      </p>
    </section>
  );
}
