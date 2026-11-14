import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Save, Trash2 } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { AccountPageNav } from '../components/account/account-page-nav';
import { ResearchPreferencesSection } from '../components/account/research-preferences';
import { OrganizationPreferencesSection } from '../components/account/organization-preferences';
import {
  chainsEqual,
  reasoningEqual,
  RoleChainsEditor,
  type Reasoning,
  type AiProviderCatalog as ProviderCatalog,
  type AiProviderId as Provider,
  type Chains,
  type LocalStt,
} from '../components/account/ai-role-chains';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Spinner } from '../components/ui/spinner';
import { FetchError } from '../components/ui/fetch-error';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../lib/api';
import { useI18n, type I18nKey, type TranslateFn } from '../lib/i18n';

type ProbeStatus = 'valid' | 'invalid' | 'unknown';

interface ProviderStatus {
  provider: Provider;
  configured: boolean;
  last4: string | null;
  status: ProbeStatus | null;
  validatedAt: string | null;
  error: string | null;
}

interface AiSettings {
  providers: ProviderStatus[];
  chains: Chains;
  reasoning: Reasoning;
  catalog: ProviderCatalog[];
  local: LocalStt;
}

const MIN_KEY_LENGTH = 20;

function errorMessage(error: unknown, t: TranslateFn): string {
  if (error instanceof ApiError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === 'INVALID_KEY') return t('account.ai.invalidKey');
    if (code === 'RATE_LIMITED') return t('account.ai.rateLimited');
    if (code === 'INVALID_ROLES') return t('account.ai.rolesInvalid');
    if (code === 'LLM_AUTH') return t('account.ai.rejected');
  }
  return t('common.error');
}

export function ContaIaPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [draftChains, setDraftChains] = useState<Chains>({});
  const [draftReasoning, setDraftReasoning] = useState<Reasoning>({
    fast: 'medium',
    standard: 'medium',
    vision: 'medium',
  });
  const [keys, setKeys] = useState<Partial<Record<Provider, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProviderCatalog | null>(null);

  async function refresh(): Promise<void> {
    setLoadError(null);
    setRefreshing(true);
    try {
      const next = await apiGet<AiSettings>('/api/account/ai');
      setSettings(next);
      setDraftChains(next.chains);
      setDraftReasoning(next.reasoning);
    } catch (error) {
      setLoadError(errorMessage(error, t));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(action: string, task: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(action);
    try {
      await task();
    } catch (error) {
      toast.error(errorMessage(error, t));
    } finally {
      setBusy(null);
    }
  }

  const saveKey = (provider: Provider) =>
    run(`save:${provider}`, async () => {
      try {
        const response = await apiPut<{ result: ProbeStatus }>(
          `/api/account/ai/providers/${provider}`,
          { apiKey: (keys[provider] ?? '').trim() },
        );
        toast[response.result === 'valid' ? 'success' : 'warning'](
          response.result === 'valid' ? t('account.ai.saved') : t('account.ai.savedUnknown'),
        );
        setKeys((current) => ({ ...current, [provider]: '' }));
      } finally {
        await refresh();
      }
    });

  const testKey = (provider: Provider) =>
    run(`test:${provider}`, async () => {
      await apiPost(`/api/account/ai/providers/${provider}/test`);
      toast.success(t('account.ai.tested'));
      await refresh();
    });

  const removeKey = (provider: Provider) =>
    run(`remove:${provider}`, async () => {
      await apiDelete(`/api/account/ai/providers/${provider}`);
      toast.success(t('account.ai.removed'));
      await refresh();
    });

  const saveRoles = () =>
    run('roles', async () => {
      await apiPut('/api/account/ai/roles', { ...draftChains, reasoning: draftReasoning });
      toast.success(t('account.ai.rolesSaved'));
      await refresh();
    });

  const configured = useMemo(
    () =>
      new Set(
        (settings?.providers ?? []).filter((item) => item.configured).map((item) => item.provider),
      ),
    [settings],
  );

  // The editor shows with no key when local STT is offered or already in the chain.
  const canEditRoles =
    settings !== null &&
    (configured.size > 0 ||
      settings.local.available ||
      (settings.chains.stt ?? []).some((entry) => entry.provider === 'local'));

  const rolesChanged =
    settings !== null &&
    (!chainsEqual(draftChains, settings.chains) ||
      !reasoningEqual(draftReasoning, settings.reasoning));

  function formatDate(value: string): string {
    return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  }

  return (
    <PageShell width="wide">
      <PageHeader title={t('account.ai.title')} description={t('account.ai.description')} />

      <AccountPageNav />

      {loadError && (
        <FetchError message={loadError} onRetry={() => void refresh()} retrying={refreshing} />
      )}

      {settings === null ? (
        !loadError && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {settings.catalog.map((catalog) => {
              const status = settings.providers.find((item) => item.provider === catalog.provider);
              const isConfigured = status?.configured === true;
              const draftKey = keys[catalog.provider] ?? '';
              const inputId = `ai-key-${catalog.provider}`;
              const statusKey: I18nKey = isConfigured
                ? `account.ai.status.${status?.status ?? 'unknown'}`
                : 'account.ai.status.none';
              return (
                <Card key={catalog.provider} elevated>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="font-display">{catalog.label}</CardTitle>
                      <Badge
                        variant={
                          !isConfigured
                            ? 'muted'
                            : status?.status === 'valid'
                              ? 'success'
                              : status?.status === 'invalid'
                                ? 'danger'
                                : 'warning'
                        }
                      >
                        {t(statusKey)}
                      </Badge>
                    </div>
                    {isConfigured && (
                      <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-[var(--color-app-fg)]">
                          ••••{status?.last4}
                        </span>
                        {status?.validatedAt && (
                          <span>
                            {t('account.ai.validatedAt', { date: formatDate(status.validatedAt) })}
                          </span>
                        )}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isConfigured && status?.status !== 'valid' && (
                      <p className="flex gap-2 text-xs text-[var(--color-app-muted)]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-app-warning-fg)]" />
                        {status?.status === 'invalid'
                          ? t('account.ai.invalidWarning')
                          : t('account.ai.unknownWarning')}
                      </p>
                    )}
                    {catalog.provider === 'anthropic' && (
                      <p className="text-xs text-[var(--color-app-muted)]">
                        {t('account.ai.anthropicNoStt')}
                      </p>
                    )}
                    {catalog.provider === 'google' && (
                      <p className="flex gap-2 text-xs text-[var(--color-app-muted)]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-app-warning-fg)]" />
                        {t('account.ai.geminiFreeTier')}
                      </p>
                    )}
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (draftKey.trim().length >= MIN_KEY_LENGTH)
                          void saveKey(catalog.provider);
                      }}
                    >
                      <Label htmlFor={inputId}>{t('account.ai.keyLabel')}</Label>
                      <Input
                        id={inputId}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={300}
                        value={draftKey}
                        placeholder={
                          isConfigured
                            ? t('account.ai.replacePlaceholder')
                            : t('account.ai.keyPlaceholder')
                        }
                        onChange={(event) =>
                          setKeys((current) => ({
                            ...current,
                            [catalog.provider]: event.target.value,
                          }))
                        }
                        className="font-mono text-xs"
                      />
                      <p className="text-[11px] text-[var(--color-app-muted)]">
                        {t('account.ai.keyHint')}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          type="submit"
                          size="sm"
                          variant="primary"
                          disabled={busy !== null || draftKey.trim().length < MIN_KEY_LENGTH}
                        >
                          {busy === `save:${catalog.provider}` ? (
                            <Spinner />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {t('account.ai.save')}
                        </Button>
                        {isConfigured && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void testKey(catalog.provider)}
                            >
                              {busy === `test:${catalog.provider}` ? (
                                <Spinner />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              {t('account.ai.test')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() => setRemoveTarget(catalog)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('account.ai.remove')}
                            </Button>
                          </>
                        )}
                      </div>
                    </form>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card elevated>
            <CardHeader>
              <CardTitle className="font-display">{t('account.ai.rolesTitle')}</CardTitle>
              <CardDescription>{t('account.ai.rolesDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditRoles ? (
                <p className="py-2 text-sm text-[var(--color-app-muted)]">
                  {t('account.ai.rolesEmpty')}
                </p>
              ) : (
                <>
                  <RoleChainsEditor
                    catalog={settings.catalog}
                    configured={configured}
                    local={settings.local}
                    chains={draftChains}
                    onChange={setDraftChains}
                    reasoning={draftReasoning}
                    onReasoningChange={setDraftReasoning}
                    disabled={busy !== null}
                    t={t}
                    locale={locale}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy !== null || !rolesChanged}
                    onClick={() => void saveRoles()}
                  >
                    {busy === 'roles' ? <Spinner /> : <Save className="h-4 w-4" />}
                    {t('account.ai.rolesSave')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
          <OrganizationPreferencesSection />
          <ResearchPreferencesSection />
        </>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t('account.ai.removeTitle', { provider: removeTarget?.label ?? '' })}
        description={t('account.ai.removeDescription')}
        confirmLabel={t('account.ai.remove')}
        variant="destructive"
        onConfirm={async () => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) await removeKey(target.provider);
        }}
      />
    </PageShell>
  );
}
