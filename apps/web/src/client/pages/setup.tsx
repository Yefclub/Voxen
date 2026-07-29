import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Languages,
  RotateCw,
} from '@/components/ui/icons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { Badge } from '../components/ui/badge';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { OrModel } from '../lib/types';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { ModelPicker } from '../components/model-picker';
import { LOCALES, useI18n, type Locale } from '../lib/i18n';
import { detectBrowserTimezone, TimezoneSelect } from '../components/timezone-select';
import { DEFAULT_TEXT_MODEL, DEFAULT_TRANSCRIPTION_MODEL } from '../../lib/model-defaults';

interface ModelsResponse {
  chat: OrModel[];
  transcription: OrModel[];
  vision: OrModel[];
  document: OrModel[];
  xAnalysis: OrModel[];
  web: OrModel[];
}

interface SetupStatus {
  complete: boolean;
  language: Locale;
  timezone: string;
  chatModel: string | null;
  transcriptionModel: string | null;
  webSearchModel: string | null;
  visionModel: string | null;
  documentModel: string | null;
  xAnalysisModel: string | null;
  hasApiKey: boolean;
}

type Step = 'loading' | 'key' | 'modelos' | 'done';

export function SetupPage(): React.ReactElement {
  const { locale, setLocale, t } = useI18n();
  const [step, setStep] = useState<Step>('loading');
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [appLanguage, setAppLanguage] = useState<Locale>(locale);
  const [appTimezone, setAppTimezone] = useState(() => detectBrowserTimezone());
  const [apiKey, setApiKey] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [webSearchModel, setWebSearchModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [documentModel, setDocumentModel] = useState('');
  const [xAnalysisModel, setXAnalysisModel] = useState('');
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useMe();

  // Carrega estado atual ao montar
  useEffect(() => {
    let cancelled = false;

    function hydrateStatus(s: SetupStatus): void {
      setStatus(s);
      setAppLanguage(s.language);
      setLocale(s.language);
      if (s.timezone) setAppTimezone(s.timezone);
      if (!s.complete) return;
      setChatModel(s.chatModel ?? '');
      setTranscriptionModel(s.transcriptionModel ?? '');
      setWebSearchModel(s.webSearchModel ?? '');
      setVisionModel(s.visionModel ?? '');
      setDocumentModel(s.documentModel ?? '');
      setXAnalysisModel(s.xAnalysisModel ?? '');
    }

    async function load(): Promise<void> {
      try {
        const s = await apiGet<SetupStatus>('/api/setup');
        if (cancelled) return;
        hydrateStatus(s);
        if (!s.complete) {
          setStep('key');
          return;
        }
        const data = await apiPost<ModelsResponse>('/api/setup/models', {});
        if (cancelled) return;
        setModels(data);
        if (!s.transcriptionModel) {
          setTranscriptionModel(preferredTranscriptionModel(data.transcription)?.id ?? '');
        }
        if (!s.chatModel) {
          setChatModel(preferredChatModel(data.chat)?.id ?? data.chat[0]?.id ?? '');
        }
        if (!s.webSearchModel) {
          setWebSearchModel(preferredChatModel(data.web)?.id ?? data.web[0]?.id ?? '');
        }
        if (!s.visionModel) {
          setVisionModel(preferredChatModel(data.vision)?.id ?? data.vision[0]?.id ?? '');
        }
        if (!s.documentModel) {
          setDocumentModel(preferredChatModel(data.document)?.id ?? data.document[0]?.id ?? '');
        }
        if (!s.xAnalysisModel) {
          setXAnalysisModel(preferredXModel(data.xAnalysis)?.id ?? data.xAnalysis[0]?.id ?? '');
        }
        setStep('modelos');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : t('setup.error.load'));
        setStep('key');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [setLocale]);

  async function refreshStatus(): Promise<void> {
    const s = await apiGet<SetupStatus>('/api/setup');
    setStatus(s);
    setAppLanguage(s.language);
    setLocale(s.language);
    setChatModel(s.chatModel ?? '');
    setTranscriptionModel(s.transcriptionModel ?? '');
    setWebSearchModel(s.webSearchModel ?? '');
    setVisionModel(s.visionModel ?? '');
    setDocumentModel(s.documentModel ?? '');
    setXAnalysisModel(s.xAnalysisModel ?? '');
  }

  async function validateAndListModels(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      const data = await apiPost<ModelsResponse>('/api/setup/models', {
        openrouter_api_key: apiKey,
      });
      setModels(data);
      if (!transcriptionModel) {
        setTranscriptionModel(preferredTranscriptionModel(data.transcription)?.id ?? '');
      }
      if (!chatModel) setChatModel(preferredChatModel(data.chat)?.id ?? data.chat[0]?.id ?? '');
      if (!webSearchModel) {
        setWebSearchModel(preferredChatModel(data.web)?.id ?? data.web[0]?.id ?? '');
      }
      if (!visionModel) {
        setVisionModel(preferredChatModel(data.vision)?.id ?? data.vision[0]?.id ?? '');
      }
      if (!documentModel) {
        setDocumentModel(preferredChatModel(data.document)?.id ?? data.document[0]?.id ?? '');
      }
      if (!xAnalysisModel) {
        setXAnalysisModel(preferredXModel(data.xAnalysis)?.id ?? data.xAnalysis[0]?.id ?? '');
      }
      setStep('modelos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('setup.error.key'));
    } finally {
      setLoading(false);
    }
  }

  async function refreshModelCatalog(): Promise<void> {
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      const body = apiKey.trim() ? { openrouter_api_key: apiKey.trim() } : {};
      const data = await apiPost<ModelsResponse>('/api/setup/models', body);
      setModels(data);
      if (!transcriptionModel) {
        setTranscriptionModel(preferredTranscriptionModel(data.transcription)?.id ?? '');
      }
      if (!chatModel) setChatModel(preferredChatModel(data.chat)?.id ?? data.chat[0]?.id ?? '');
      if (!webSearchModel) {
        setWebSearchModel(preferredChatModel(data.web)?.id ?? data.web[0]?.id ?? '');
      }
      if (!visionModel) {
        setVisionModel(preferredChatModel(data.vision)?.id ?? data.vision[0]?.id ?? '');
      }
      if (!documentModel) {
        setDocumentModel(preferredChatModel(data.document)?.id ?? data.document[0]?.id ?? '');
      }
      if (!xAnalysisModel) {
        setXAnalysisModel(preferredXModel(data.xAnalysis)?.id ?? data.xAnalysis[0]?.id ?? '');
      }
      setStep('modelos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('setup.error.models'));
    } finally {
      setLoading(false);
    }
  }

  async function saveSetup(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    const wasConfigured = Boolean(status?.complete);
    try {
      const body: Record<string, string | boolean> = {
        app_language: appLanguage,
        app_timezone: appTimezone,
        default_chat_model: chatModel,
        default_transcription_model: transcriptionModel,
      };
      body.default_web_search_model = webSearchModel;
      body.default_vision_model = visionModel;
      body.default_document_model = documentModel;
      body.default_x_analysis_model = xAnalysisModel;
      if (apiKey.trim()) {
        body.openrouter_api_key = apiKey.trim();
      }
      await apiPost('/api/setup', body);
      await refreshStatus().catch(() => undefined);
      await refresh();
      setApiKey('');
      if (wasConfigured) {
        setSaved(true);
        return;
      }
      setStep('done');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
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
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 border border-emerald-400/50">
            <CheckCircle2 className="h-7 w-7 text-emerald-950" />
          </div>
        </div>
        <h2 className="font-display text-3xl font-semibold mt-8">{t('setup.doneTitle')}</h2>
        <p className="text-[15px] text-[var(--color-app-muted)] mt-3">{t('setup.doneSubtitle')}</p>
      </PageShell>
    );
  }

  const editingConfigured = Boolean(status?.complete && step === 'modelos');

  // Wizard de primeira configuração ou formulário direto de edição da instância.
  return (
    <PageShell width="workspace">
      <PageHeader
        eyebrow={editingConfigured ? t('setup.badge.edit') : t('setup.badge.initial')}
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

      {/* Stepper */}
      {!editingConfigured && (
        <div className="mb-8 flex items-center gap-3">
          <StepDot
            index={1}
            active={step === 'key'}
            done={step !== 'key'}
            label={t('setup.step.key')}
          />
          <div className="flex-1 h-px relative">
            <div className="absolute inset-0 bg-[var(--color-app-border)]" />
            <div
              className="absolute inset-0 origin-left bg-gradient-to-r from-emerald-400 to-violet-400 transition-transform duration-300 motion-reduce:transition-none"
              style={{ transform: `scaleX(${step === 'key' ? 0 : 1})` }}
            />
          </div>
          <StepDot
            index={2}
            active={step === 'modelos'}
            done={false}
            label={t('setup.step.models')}
          />
        </div>
      )}

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

      <>
        {step === 'key' && (
          <div>
            <Card elevated>
              <CardHeader>
                <CardTitle className="flex items-center gap-2.5 font-display">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                  </span>
                  {t('setup.openrouter.apiKey')}
                </CardTitle>
                <CardDescription>
                  {t('setup.openrouter.description.new')}{' '}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--color-app-fg)] underline-offset-4 hover:text-emerald-400 hover:underline transition-colors"
                  >
                    OpenRouter
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={validateAndListModels} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="key">{t('setup.openrouter.apiKey')}</Label>
                    <Input
                      id="key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      autoComplete="off"
                      spellCheck={false}
                      required
                      minLength={20}
                      className="font-mono h-11 text-[15px]"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      disabled={loading}
                      className="w-full h-11"
                    >
                      {loading ? <Spinner /> : t('onboarding.validateContinue')}
                      {!loading && <ArrowRight className="h-4 w-4" />}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'modelos' && models && (
          <div>
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
                      <CardTitle className="flex items-center gap-2 font-display">
                        <KeyRound className="h-4 w-4 text-emerald-400" />
                        {t('setup.openrouter.title')}
                      </CardTitle>
                      <CardDescription>
                        {status?.complete
                          ? t('setup.openrouter.description.active')
                          : t('setup.openrouter.description.new')}
                      </CardDescription>
                    </div>
                    {status?.hasApiKey && (
                      <Badge variant="success">{t('setup.openrouter.active')}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {status?.hasApiKey && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-200">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{t('setup.openrouter.stored')}</span>
                      <span className="ml-auto font-mono text-[11px] tracking-widest text-emerald-300/80">
                        ••••••••••••
                      </span>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="configured-key">
                        {status?.complete
                          ? t('setup.openrouter.newKey')
                          : t('setup.openrouter.apiKey')}
                      </Label>
                      <Input
                        id="configured-key"
                        type="password"
                        value={apiKey}
                        onChange={(e) => {
                          setSaved(false);
                          setApiKey(e.target.value);
                        }}
                        placeholder={t('setup.openrouter.newKeyPlaceholder')}
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono h-11 text-[15px]"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => void refreshModelCatalog()}
                      disabled={loading}
                    >
                      {loading ? <Spinner /> : <RotateCw className="h-4 w-4" />}
                      {t('setup.openrouter.refreshModels')}
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {status?.complete
                      ? t('setup.openrouter.refreshHint.active')
                      : t('setup.openrouter.refreshHint.new')}
                  </p>
                </CardContent>
              </Card>

              <Card elevated>
                <CardHeader>
                  <CardTitle className="font-display">{t('setup.models.title')}</CardTitle>
                  <CardDescription>{t('setup.models.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <ModelPicker
                    label={t('setup.models.transcription')}
                    value={transcriptionModel}
                    onChange={setTranscriptionModel}
                    options={models.transcription}
                    count={models.transcription.length}
                  />
                  <ModelPicker
                    label={t('setup.models.chat')}
                    value={chatModel}
                    onChange={setChatModel}
                    options={models.chat}
                    count={models.chat.length}
                  />
                  <ModelPicker
                    label={t('setup.models.web')}
                    value={webSearchModel}
                    onChange={setWebSearchModel}
                    options={models.web}
                    count={models.web.length}
                    optional
                    hint={t('setup.models.webHint')}
                  />
                  <ModelPicker
                    label={t('setup.models.vision')}
                    value={visionModel}
                    onChange={setVisionModel}
                    options={models.vision}
                    count={models.vision.length}
                    optional
                    hint={t('setup.models.visionHint')}
                  />
                  <ModelPicker
                    label={t('setup.models.documents')}
                    value={documentModel}
                    onChange={setDocumentModel}
                    options={models.document}
                    count={models.document.length}
                    optional
                    hint={t('setup.models.documentsHint')}
                  />
                  <ModelPicker
                    label={t('setup.models.x')}
                    value={xAnalysisModel}
                    onChange={setXAnalysisModel}
                    options={models.xAnalysis}
                    count={models.xAnalysis.length}
                    optional
                    hint={t('setup.models.xHint')}
                  />
                </CardContent>
              </Card>

              <div className="flex justify-end gap-3 pt-2">
                {!editingConfigured && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setStep('key');
                      setError(null);
                    }}
                  >
                    {t('common.back')}
                  </Button>
                )}
                <Button type="submit" variant="primary" size="lg" disabled={loading}>
                  {loading ? (
                    <Spinner />
                  ) : editingConfigured ? (
                    t('setup.save')
                  ) : (
                    t('common.saveContinue')
                  )}
                  {!loading && <ArrowRight className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        )}
      </>
    </PageShell>
  );
}

function preferredXModel(models: OrModel[]): OrModel | undefined {
  return (
    models.find((m) => m.id === DEFAULT_TEXT_MODEL) ??
    models.find((m) => m.id.toLowerCase().includes('grok-4')) ??
    models.find((m) => m.id.toLowerCase().includes('grok'))
  );
}

function preferredTranscriptionModel(models: OrModel[]): OrModel | undefined {
  return (
    models.find((m) => m.id === DEFAULT_TRANSCRIPTION_MODEL) ??
    models.find((m) => m.id.toLowerCase().includes('whisper')) ??
    models[0]
  );
}

function preferredChatModel(models: OrModel[]): OrModel | undefined {
  return models.find((m) => m.id === DEFAULT_TEXT_MODEL) ?? models[0];
}

function StepDot({
  index,
  active,
  done,
  label,
}: {
  index: number;
  active: boolean;
  done: boolean;
  label: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={[
          'h-7 w-7 rounded-full border flex items-center justify-center text-[11px] font-bold transition-all duration-300',
          done
            ? 'bg-emerald-500 border-emerald-400 text-emerald-950'
            : active
              ? 'bg-[var(--color-app-inverted)] border-[var(--color-app-inverted)] text-[var(--color-app-inverted-fg)]'
              : 'bg-transparent border-[var(--color-app-border-strong)] text-[var(--color-app-muted)]',
        ].join(' ')}
      >
        {done ? '✓' : index}
      </div>
      <span
        className={
          active || done
            ? 'text-[var(--color-app-fg)] text-sm font-medium'
            : 'text-[var(--color-app-muted)] text-sm'
        }
      >
        {label}
      </span>
    </div>
  );
}
