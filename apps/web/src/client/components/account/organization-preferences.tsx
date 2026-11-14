import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { apiPut } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import {
  organizationErrorText,
  type OrganizationMode,
  type OrganizationPreferences,
} from '../../lib/organization-api';

export function OrganizationPreferencesSection(): React.ReactElement {
  const { t } = useI18n(),
    { hash } = useLocation();
  const { data, loading, error, refresh } = useFetch<OrganizationPreferences>(
    '/api/organization/preferences',
  );
  const [draft, setDraft] = useState<OrganizationMode | null>(null);
  const [savedMode, setSavedMode] = useState<OrganizationMode | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [failed, setFailed] = useState(false);
  const mode = draft ?? savedMode ?? data?.mode ?? 'OFF',
    ready = Boolean(data);
  const changed = Boolean(data && mode !== (savedMode ?? data.mode));
  useEffect(() => setSavedMode(null), [data]);
  useEffect(() => {
    if (hash !== '#library-organization' || !ready) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById('library-organization')?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash, ready]);
  async function save() {
    if (busy || !data) return;
    setBusy(true);
    setFailed(false);
    setNotice(t('organization.settings.saving'));
    try {
      await apiPut('/api/organization/preferences', { mode });
      setDraft(null);
      setSavedMode(mode);
      setNotice(t('organization.settings.saved'));
      refresh();
    } catch (error) {
      setFailed(true);
      setNotice(organizationErrorText(error, t));
    } finally {
      setBusy(false);
    }
  }
  const descriptions = {
    OFF: 'organization.settings.offDescription',
    MANUAL: 'organization.settings.manualDescription',
    AUTO: 'organization.settings.autoDescription',
  } as const;
  return (
    <section
      id="library-organization"
      aria-labelledby="library-organization-title"
      className="scroll-mt-8 space-y-5 border-t border-[var(--color-app-border)] pt-8"
    >
      <div className="max-w-[65ch] space-y-2">
        <h2
          id="library-organization-title"
          className="font-display text-xl font-semibold tracking-tight text-[var(--color-app-fg)]"
        >
          {t('organization.settings.title')}
        </h2>
        <p className="text-sm leading-6 text-[var(--color-app-muted)]">
          {t('organization.settings.description')}
        </p>
      </div>
      {error && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-app-danger)]">
          <p>{organizationErrorText(error, t)}</p>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {t('organization.retry')}
          </Button>
        </div>
      )}
      {!data ? (
        !error && <Skeleton className="h-28 w-full rounded-lg" />
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-5 md:grid-cols-2 md:gap-8">
            <div className="space-y-2">
              <Label htmlFor="library-organization-mode">{t('organization.settings.mode')}</Label>
              <select
                id="library-organization-mode"
                value={mode}
                disabled={busy}
                aria-describedby="library-organization-mode-description"
                onChange={(event) => {
                  setDraft(event.target.value as OrganizationMode);
                  setNotice('');
                }}
                className="h-11 w-full rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 text-sm text-[var(--color-app-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] disabled:opacity-50"
              >
                <option value="OFF">{t('organization.settings.off')}</option>
                <option value="MANUAL">{t('organization.settings.manual')}</option>
                <option value="AUTO">{t('organization.settings.auto')}</option>
              </select>
              <p
                id="library-organization-mode-description"
                className="text-sm leading-6 text-[var(--color-app-muted)]"
              >
                {t(descriptions[mode])}
              </p>
            </div>
            <p className="max-w-[65ch] text-sm leading-6 text-[var(--color-app-muted)] md:pt-7">
              {t('organization.settings.privacy')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              className="min-h-11"
              disabled={!changed || busy}
            >
              {t(busy ? 'organization.settings.saving' : 'organization.settings.save')}
            </Button>
            {changed && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className="min-h-11"
                onClick={() => {
                  setDraft(null);
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
        aria-live="polite"
        aria-atomic="true"
        aria-label={t('organization.settings.status')}
        className={`min-h-5 text-sm ${failed ? 'text-[var(--color-app-danger)]' : 'text-[var(--color-app-muted)]'}`}
      >
        {notice}
      </p>
    </section>
  );
}
