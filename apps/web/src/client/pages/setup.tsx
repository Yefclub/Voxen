import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ExternalLink, KeyRound, Languages } from '@/components/ui/icons';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import { LOCALES, useI18n, type Locale } from '../lib/i18n';
import { detectBrowserTimezone, TimezoneSelect } from '../components/timezone-select';

interface SetupStatus {
  complete: boolean;
  hasApiKey: boolean;
  language: Locale;
  timezone: string;
}

type Step = 'loading' | 'form' | 'done';

type ModelPurpose =
  | 'default_chat_model'
  | 'default_transcription_model'
  | 'default_web_search_model'
  | 'default_vision_model'
  | 'default_document_model'
  | 'default_x_analysis_model';

interface ModelOption {
  id: string;
  name: string;
}

interface IncompatibleModel {
  purpose: ModelPurpose;
  modelId: string;
  reason: 'unavailable' | 'incompatible';
  compatibleModels: ModelOption[];
}

const PURPOSE_LABEL_KEYS: Record<
  ModelPurpose,
  | 'admin.integrations.models.purpose.chat'
  | 'admin.integrations.models.purpose.transcription'
  | 'admin.integrations.models.purpose.webSearch'
  | 'admin.integrations.models.purpose.vision'
  | 'admin.integrations.models.purpose.document'
  | 'admin.integrations.models.purpose.xAnalysis'
> = {
  default_chat_model: 'admin.integrations.models.purpose.chat',
  default_transcription_model: 'admin.integrations.models.purpose.transcription',
  default_web_search_model: 'admin.integrations.models.purpose.webSearch',
  default_vision_model: 'admin.integrations.models.purpose.vision',
  default_document_model: 'admin.integrations.models.purpose.document',
  default_x_analysis_model: 'admin.integrations.models.purpose.xAnalysis',
};

function incompatibleModelsFrom(body: unknown): IncompatibleModel[] | null {
  if (!body || typeof body !== 'object' || !('incompatible' in body)) return null;
  const incompatible = (body as { incompatible?: unknown }).incompatible;
  if (!Array.isArray(incompatible)) return null;
  return incompatible.filter((item): item is IncompatibleModel =>
    Boolean(
      item &&
      typeof item === 'object' &&
      'purpose' in item &&
      'modelId' in item &&
      'reason' in item &&
      'compatibleModels' in item &&
      Array.isArray(item.compatibleModels),
    ),
  );
}

export function SetupPage(): React.ReactElement {
  const { locale, setLocale, t } = useI18n();
  const [step, setStep] = useState<Step>('loading');
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [appLanguage, setAppLanguage] = useState<Locale>(locale);
  const [appTimezone, setAppTimezone] = useState(() => detectBrowserTimezone());
  const [apiKey, setApiKey] = useState('');
  const [incompatibleModels, setIncompatibleModels] = useState<IncompatibleModel[]>([]);
  const [modelReplacements, setModelReplacements] = useState<Partial<Record<ModelPurpose, string>>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useMe();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const nextStatus = await apiGet<SetupStatus>('/api/setup');
        if (cancelled) return;
        setStatus(nextStatus);
        setAppLanguage(nextStatus.language);
        setLocale(nextStatus.language);
        if (nextStatus.timezone) setAppTimezone(nextStatus.timezone);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : t('setup.error.load'));
      } finally {
        if (!cancelled) setStep('form');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [setLocale]);

  async function saveSetup(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    const wasConfigured = Boolean(status?.complete);

    try {
      const body: Record<string, unknown> = {
        app_language: appLanguage,
        app_timezone: appTimezone,
      };
      if (apiKey.trim()) body.openrouter_api_key = apiKey.trim();
      if (Object.keys(modelReplacements).length > 0) body.model_replacements = modelReplacements;
      const result = await apiPost<{ complete: boolean }>('/api/setup', body);
      setStatus({
        complete: result.complete,
        hasApiKey: result.complete || Boolean(status?.hasApiKey),
        language: appLanguage,
        timezone: appTimezone,
      });
      await refresh();
      setApiKey('');
      setIncompatibleModels([]);
      setModelReplacements({});
      if (wasConfigured) {
        setSaved(true);
        return;
      }
      setStep('done');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      const incompatible = err instanceof ApiError ? incompatibleModelsFrom(err.body) : null;
      if (incompatible) {
        setIncompatibleModels(incompatible);
        setModelReplacements(
          (current) =>
            Object.fromEntries(
              incompatible.map((item) => [
                item.purpose,
                current[item.purpose] ?? item.compatibleModels[0]?.id ?? '',
              ]),
            ) as Partial<Record<ModelPurpose, string>>,
        );
      }
      setError(err instanceof ApiError ? err.message : t('setup.error.save'));
    } finally {
      setLoading(false);
    }
  }

  if (step === 'loading') {
    return (
      <PageShell width="workspace" className="flex min-h-64 items-center justify-center">
        <Spinner size={22} className="text-[var(--color-app-muted)]" />
      </PageShell>
    );
  }

  if (step === 'done') {
    return (
      <PageShell
        width="workspace"
        className="flex min-h-[60dvh] flex-col items-center justify-center text-center"
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-emerald-500/40 blur-2xl" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/50 bg-gradient-to-br from-emerald-400 to-emerald-600">
            <CheckCircle2 className="h-7 w-7 text-emerald-950" />
          </div>
        </div>
        <h2 className="mt-8 font-display text-3xl font-semibold">{t('setup.doneTitle')}</h2>
        <p className="mt-3 text-[15px] text-[var(--color-app-muted)]">{t('setup.doneSubtitle')}</p>
      </PageShell>
    );
  }

  const editingConfigured = Boolean(status?.complete);
  const trimmedKeyLength = apiKey.trim().length;
  const keyIsInvalid =
    (!editingConfigured && trimmedKeyLength < 20) ||
    (trimmedKeyLength > 0 && trimmedKeyLength < 20);
  const unresolvedModels = incompatibleModels.some(
    (item) => !modelReplacements[item.purpose] || item.compatibleModels.length === 0,
  );

  return (
    <PageShell width="workspace">
      <PageHeader
        eyebrow={editingConfigured ? t('setup.badge.edit') : t('setup.badge.initial')}
        icon={KeyRound}
        iconClassName="text-emerald-400"
        title={
          editingConfigured ? (
            t('setup.title.edit')
          ) : (
            <>
              {t('setup.title.initialPrefix')}
              <span className="text-emerald-accent">OpenRouter</span>
              {t('setup.title.initialSuffix')}
            </>
          )
        }
        description={editingConfigured ? t('setup.subtitle.edit') : t('setup.subtitle.initial')}
      />

      {error && (
        <div className="mb-6">
          <Alert variant="destructive">
            <AlertTitle>{t('setup.validationTitle')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {saved && (
        <div className="mb-6">
          <Alert variant="success">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            <AlertDescription>{t('setup.saved')}</AlertDescription>
          </Alert>
        </div>
      )}

      <form onSubmit={saveSetup} className="space-y-5">
        <Card elevated>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display">
              <Languages className="h-4 w-4 text-emerald-400" />
              {t('setup.language.title')}
            </CardTitle>
            <CardDescription>{t('setup.language.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {(Object.keys(LOCALES) as Locale[]).map((language) => (
                <button
                  key={language}
                  type="button"
                  onClick={() => {
                    setSaved(false);
                    setAppLanguage(language);
                    setLocale(language);
                  }}
                  className={[
                    'rounded-xl border px-4 py-3 text-left transition-colors',
                    appLanguage === language
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                      : 'border-[var(--color-app-border)] bg-[var(--color-app-surface)] hover:border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface-hover)]',
                  ].join(' ')}
                >
                  <span className="block text-sm font-semibold">
                    {LOCALES[language].nativeName}
                  </span>
                  <span className="mt-1 block text-[11px] uppercase tracking-wider text-[var(--color-app-muted)]">
                    {LOCALES[language].shortName}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-5">
              <TimezoneSelect
                id="setup-timezone"
                value={appTimezone}
                onChange={(next) => {
                  setSaved(false);
                  setAppTimezone(next);
                }}
                label={t('setup.timezone.title')}
                hint={t('setup.timezone.description')}
              />
            </div>
          </CardContent>
        </Card>

        <Card elevated>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2.5 font-display">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                    <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                  </span>
                  {t('setup.openrouter.title')}
                </CardTitle>
                <CardDescription>
                  {editingConfigured
                    ? t('setup.openrouter.description.active')
                    : t('setup.openrouter.description.new')}{' '}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--color-app-fg)] underline-offset-4 transition-colors hover:text-emerald-400 hover:underline"
                  >
                    OpenRouter
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </CardDescription>
              </div>
              {status?.hasApiKey && <Badge variant="success">{t('setup.openrouter.active')}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {status?.hasApiKey && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{t('setup.openrouter.stored')}</span>
                <span className="ml-auto font-mono text-[11px] tracking-widest text-emerald-300/80">
                  ••••••••••••
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="openrouter-key">
                {editingConfigured ? t('setup.openrouter.newKey') : t('setup.openrouter.apiKey')}
              </Label>
              <Input
                id="openrouter-key"
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setSaved(false);
                  setApiKey(event.target.value);
                  setIncompatibleModels([]);
                  setModelReplacements({});
                }}
                placeholder={
                  editingConfigured ? t('setup.openrouter.newKeyPlaceholder') : 'sk-or-v1-...'
                }
                autoComplete="off"
                spellCheck={false}
                required={!editingConfigured}
                minLength={20}
                maxLength={512}
                className="h-11 font-mono text-[15px]"
              />
            </div>

            <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
              {t('setup.openrouter.defaults')}
            </p>

            {incompatibleModels.length > 0 && (
              <div className="space-y-4 rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-4">
                <div>
                  <p className="text-sm font-medium text-amber-100">
                    {t('setup.models.incompatibleTitle')}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                    {t('setup.models.incompatibleDescription')}
                  </p>
                </div>
                {incompatibleModels.map((item) => (
                  <div key={item.purpose} className="space-y-2">
                    <Label htmlFor={`replacement-${item.purpose}`}>
                      {t(PURPOSE_LABEL_KEYS[item.purpose])}
                    </Label>
                    <p className="text-xs text-[var(--color-app-muted)]">
                      {t(
                        item.reason === 'unavailable'
                          ? 'setup.models.reason.unavailable'
                          : 'setup.models.reason.incompatible',
                        { model: item.modelId },
                      )}
                    </p>
                    <Select
                      value={modelReplacements[item.purpose] ?? ''}
                      onValueChange={(modelId) =>
                        setModelReplacements((current) => ({ ...current, [item.purpose]: modelId }))
                      }
                    >
                      <SelectTrigger id={`replacement-${item.purpose}`}>
                        <SelectValue placeholder={t('setup.models.selectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {item.compatibleModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name} ({model.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {item.compatibleModels.length === 0 && (
                      <p className="text-xs text-amber-200">{t('setup.models.noCompatible')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading || keyIsInvalid || unresolvedModels}
              className="h-11 w-full"
            >
              {loading ? (
                <Spinner />
              ) : editingConfigured ? (
                t('setup.save')
              ) : (
                t('onboarding.validateContinue')
              )}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </CardContent>
        </Card>
      </form>
    </PageShell>
  );
}
