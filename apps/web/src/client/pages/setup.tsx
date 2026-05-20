import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  DownloadCloud,
  ExternalLink,
  KeyRound,
  Mail,
  RotateCw,
  Sparkles,
  Timer,
} from 'lucide-react';
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
import { AnimatedPage } from '../components/motion/animated-page';
import { ModelPicker } from '../components/model-picker';

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
  chatModel: string | null;
  transcriptionModel: string | null;
  webSearchModel: string | null;
  visionModel: string | null;
  documentModel: string | null;
  xAnalysisModel: string | null;
  adminEmail: string | null;
  summaryTimeoutSec: string | null;
  hasApiKey: boolean;
  ytDlp?: {
    proxies: boolean;
  };
}

type Step = 'loading' | 'key' | 'modelos' | 'done';

export function SetupPage(): React.ReactElement {
  const [step, setStep] = useState<Step>('loading');
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [webSearchModel, setWebSearchModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [documentModel, setDocumentModel] = useState('');
  const [xAnalysisModel, setXAnalysisModel] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [summaryTimeoutSec, setSummaryTimeoutSec] = useState('');
  const [ytDlpProxyUrls, setYtDlpProxyUrls] = useState('');
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
      if (!s.complete) return;
      setChatModel(s.chatModel ?? '');
      setTranscriptionModel(s.transcriptionModel ?? '');
      setWebSearchModel(s.webSearchModel ?? '');
      setVisionModel(s.visionModel ?? '');
      setDocumentModel(s.documentModel ?? '');
      setXAnalysisModel(s.xAnalysisModel ?? '');
      setAdminEmail(s.adminEmail ?? '');
      setSummaryTimeoutSec(s.summaryTimeoutSec ?? '');
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
        if (!s.documentModel) {
          setDocumentModel(data.document[0]?.id ?? '');
        }
        if (!s.xAnalysisModel) {
          setXAnalysisModel(preferredXModel(data.xAnalysis)?.id ?? data.xAnalysis[0]?.id ?? '');
        }
        setStep('modelos');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Erro ao carregar configuração.');
        setStep('key');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshStatus(): Promise<void> {
    const s = await apiGet<SetupStatus>('/api/setup');
    setStatus(s);
    setChatModel(s.chatModel ?? '');
    setTranscriptionModel(s.transcriptionModel ?? '');
    setWebSearchModel(s.webSearchModel ?? '');
    setVisionModel(s.visionModel ?? '');
    setDocumentModel(s.documentModel ?? '');
    setXAnalysisModel(s.xAnalysisModel ?? '');
    setAdminEmail(s.adminEmail ?? '');
    setSummaryTimeoutSec(s.summaryTimeoutSec ?? '');
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
      if (!documentModel) setDocumentModel(data.document[0]?.id ?? '');
      if (!xAnalysisModel) {
        setXAnalysisModel(preferredXModel(data.xAnalysis)?.id ?? data.xAnalysis[0]?.id ?? '');
      }
      setStep('modelos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao validar chave.');
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
      if (!documentModel) setDocumentModel(data.document[0]?.id ?? '');
      if (!xAnalysisModel) {
        setXAnalysisModel(preferredXModel(data.xAnalysis)?.id ?? data.xAnalysis[0]?.id ?? '');
      }
      setStep('modelos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao listar modelos.');
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
        default_chat_model: chatModel,
        default_transcription_model: transcriptionModel,
      };
      body.default_web_search_model = webSearchModel;
      body.default_vision_model = visionModel;
      body.default_document_model = documentModel;
      body.default_x_analysis_model = xAnalysisModel;
      body.admin_email = adminEmail.trim();
      body.summary_timeout_sec = summaryTimeoutSec.trim();
      body.yt_dlp_proxy_urls = ytDlpProxyUrls.trim();
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
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'loading') {
    return (
      <div className="px-8 py-24 flex justify-center">
        <Spinner size={22} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  if (step === 'done') {
    return (
      <AnimatedPage>
        <div className="mx-auto max-w-3xl px-6 py-20 flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 250, damping: 18 }}
            className="relative"
          >
            <div className="absolute inset-0 rounded-full bg-emerald-500/40 blur-2xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 border border-emerald-400/50">
              <CheckCircle2 className="h-7 w-7 text-emerald-950" strokeWidth={2.5} />
            </div>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="font-display text-3xl font-semibold mt-8"
          >
            Salvo.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="text-[15px] text-[var(--color-app-muted)] mt-3"
          >
            Configuração atualizada. Levando você ao painel…
          </motion.p>
        </div>
      </AnimatedPage>
    );
  }

  const editingConfigured = Boolean(status?.complete && step === 'modelos');

  // Wizard de primeira configuração ou formulário direto de edição da instância.
  return (
    <AnimatedPage>
      <div className="mx-auto max-w-4xl px-6 py-12">
        <PageHeader
          badge={editingConfigured ? 'Configurações' : 'Configuração inicial'}
          title={
            editingConfigured ? (
              'Configurações da instância'
            ) : (
              <>
                Conecte com a <span className="text-emerald-accent">OpenRouter</span>
              </>
            )
          }
          sub={
            editingConfigured
              ? 'Edite chave, modelos padrão, operação e extração de mídia sem sair da página.'
              : 'Uma chave da OpenRouter dá acesso a Whisper para transcrição e a vários modelos de chat. É a única dependência externa do Voxen.'
          }
        />

        {/* Stepper */}
        {!editingConfigured && (
          <div className="mb-8 flex items-center gap-3">
            <StepDot index={1} active={step === 'key'} done={step !== 'key'} label="Chave" />
            <div className="flex-1 h-px relative">
              <div className="absolute inset-0 bg-[var(--color-app-border)]" />
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: step === 'key' ? 0 : 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 origin-left bg-gradient-to-r from-emerald-400 to-violet-400"
              />
            </div>
            <StepDot index={2} active={step === 'modelos'} done={false} label="Modelos" />
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Alert variant="destructive">
              <AlertTitle>Não consegui validar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </motion.div>
        )}

        {saved && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Alert variant="success">
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
              <AlertDescription>Configurações salvas.</AlertDescription>
            </Alert>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {step === 'key' && (
            <motion.div
              key="key"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <Card elevated>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2.5 font-display">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                      <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                    </span>
                    Cole sua chave
                  </CardTitle>
                  <CardDescription>
                    Será validada antes de ser salva.{' '}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-zinc-100 underline-offset-4 hover:text-emerald-400 hover:underline transition-colors"
                    >
                      Gerar chave
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={validateAndListModels} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="key">OpenRouter API key</Label>
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
                        {loading ? <Spinner /> : 'Validar e continuar'}
                        {!loading && <ArrowRight className="h-4 w-4" />}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 'modelos' && models && (
            <motion.div
              key="modelos"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <form onSubmit={saveSetup} className="space-y-5">
                <Card elevated>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2 font-display">
                          <KeyRound className="h-4 w-4 text-emerald-400" />
                          OpenRouter
                        </CardTitle>
                        <CardDescription>
                          {status?.complete
                            ? 'A chave salva permanece cifrada. Cole uma nova apenas quando quiser substituir a atual.'
                            : 'A chave validada será salva junto com os modelos escolhidos.'}
                        </CardDescription>
                      </div>
                      {status?.hasApiKey && <Badge variant="success">Chave ativa</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {status?.hasApiKey && (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-200">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>Chave armazenada e pronta para uso.</span>
                        <span className="ml-auto font-mono text-[11px] tracking-widest text-emerald-300/80">
                          ••••••••••••
                        </span>
                      </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div className="space-y-2">
                        <Label htmlFor="configured-key">
                          {status?.complete
                            ? 'Nova OpenRouter API key (opcional)'
                            : 'OpenRouter API key'}
                        </Label>
                        <Input
                          id="configured-key"
                          type="password"
                          value={apiKey}
                          onChange={(e) => {
                            setSaved(false);
                            setApiKey(e.target.value);
                          }}
                          placeholder="sk-or-v1-... (opcional)"
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
                        Atualizar modelos
                      </Button>
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
                      {status?.complete
                        ? 'Atualizar modelos valida a chave digitada; se o campo estiver vazio, usa a chave já salva na instância.'
                        : 'Atualizar modelos revalida a chave digitada antes de carregar o catálogo.'}
                    </p>
                  </CardContent>
                </Card>

                <Card elevated>
                  <CardHeader>
                    <CardTitle className="font-display">Modelos padrão</CardTitle>
                    <CardDescription>
                      Escolha os modelos que a instância usa para chat, transcrição, visão,
                      documentos, pesquisa web e análise do X.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <ModelPicker
                      label="Modelo de transcrição"
                      value={transcriptionModel}
                      onChange={setTranscriptionModel}
                      options={models.transcription}
                      count={models.transcription.length}
                    />
                    <ModelPicker
                      label="Modelo de chat"
                      value={chatModel}
                      onChange={setChatModel}
                      options={models.chat}
                      count={models.chat.length}
                    />
                    <ModelPicker
                      label="Modelo de pesquisa web (opcional)"
                      value={webSearchModel}
                      onChange={setWebSearchModel}
                      options={models.web}
                      count={models.web.length}
                      optional
                      hint="Tool web_search usa este modelo com sufixo :online (plugin Perplexity). Vazio = usa o de chat."
                    />
                    <ModelPicker
                      label="Modelo de visão (opcional)"
                      value={visionModel}
                      onChange={setVisionModel}
                      options={models.vision}
                      count={models.vision.length}
                      optional
                      hint="Pra entender imagens enviadas no chat. Vazio = uploads ficam desabilitados."
                    />
                    <ModelPicker
                      label="Modelo de documentos/PDF (opcional)"
                      value={documentModel}
                      onChange={setDocumentModel}
                      options={models.document}
                      count={models.document.length}
                      optional
                      hint="Filtrado por modelos OpenRouter com entrada nativa de arquivo/PDF. Vazio = upload de documentos fica desabilitado."
                    />
                    <ModelPicker
                      label="Modelo de análise do X (Grok)"
                      value={xAnalysisModel}
                      onChange={setXAnalysisModel}
                      options={models.xAnalysis}
                      count={models.xAnalysis.length}
                      optional
                      hint="Posts do X usam Grok/xAI com busca nativa no X. Vazio = tenta análise pela extração de mídia quando houver mídia pública."
                    />
                  </CardContent>
                </Card>

                <Card elevated>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-display">
                      <DownloadCloud className="h-4 w-4 text-emerald-400" />
                      Operação da instância
                    </CardTitle>
                    <CardDescription>
                      Ajustes de operação que não são modelos: identificação do bot, timeout de
                      resumo e resiliência da extração de mídia.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Email do operador</Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
                          <Input
                            type="email"
                            value={adminEmail}
                            onChange={(e) => setAdminEmail(e.target.value)}
                            placeholder="admin@seudominio.com"
                            className="pl-9"
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--color-app-muted)] leading-snug">
                          Usado no header From do scraper quando configurado.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Timeout de resumo</Label>
                        <div className="relative">
                          <Timer className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
                          <Input
                            type="number"
                            min={30}
                            max={600}
                            step={5}
                            value={summaryTimeoutSec}
                            onChange={(e) => setSummaryTimeoutSec(e.target.value)}
                            placeholder="90"
                            className="pl-9"
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--color-app-muted)] leading-snug">
                          Em segundos. Vazio usa o padrão do serviço.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/40 p-4">
                      <div className="space-y-2">
                        <Label>Extração de mídia</Label>
                        <p className="text-[11px] text-[var(--color-app-muted)] leading-snug">
                          Em deploys home-lab (IP residencial) o YouTube praticamente não bloqueia
                          downloads. Em VPS é comum cair em soft-block: configure um proxy
                          residencial próprio abaixo ou use o upload manual quando precisar.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Label>Proxy de extração (opcional)</Label>
                          {status?.ytDlp?.proxies && (
                            <Badge variant="success">Proxy configurado</Badge>
                          )}
                        </div>
                        <textarea
                          value={ytDlpProxyUrls}
                          onChange={(e) => setYtDlpProxyUrls(e.target.value)}
                          placeholder="http://usuario:senha@host:porta&#10;socks5://host:porta"
                          rows={3}
                          spellCheck={false}
                          className="min-h-20 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60"
                        />
                        <p className="text-[11px] text-[var(--color-app-muted)] leading-snug">
                          Uma URL por linha. Use apenas proxies controlados por você (próprios ou
                          residenciais contratados). Vazio = sem proxy.
                        </p>
                      </div>
                    </div>
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
                      Voltar
                    </Button>
                  )}
                  <Button type="submit" variant="primary" size="lg" disabled={loading}>
                    {loading ? (
                      <Spinner />
                    ) : editingConfigured ? (
                      'Salvar configurações'
                    ) : (
                      'Salvar e continuar'
                    )}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AnimatedPage>
  );
}

function preferredXModel(models: OrModel[]): OrModel | undefined {
  return (
    models.find((m) => m.id === 'x-ai/grok-4-fast:free') ??
    models.find((m) => m.id.toLowerCase().includes('grok-4-fast')) ??
    models.find((m) => m.id.toLowerCase().includes('grok-4')) ??
    models.find((m) => m.id.toLowerCase().includes('grok'))
  );
}

function preferredTranscriptionModel(models: OrModel[]): OrModel | undefined {
  return (
    models.find((m) => m.id.toLowerCase().includes('whisper-large-v3-turbo')) ??
    models.find((m) => m.id.toLowerCase().includes('whisper')) ??
    models[0]
  );
}

function preferredChatModel(models: OrModel[]): OrModel | undefined {
  return (
    models.find((m) => m.id === 'google/gemini-3.1-flash-lite') ??
    models.find(
      (m) => m.id.toLowerCase().includes('gemini') && m.id.toLowerCase().includes('flash'),
    ) ??
    models.find((m) => m.id.toLowerCase().includes('sonnet')) ??
    models[0]
  );
}

function PageHeader({
  badge,
  title,
  sub,
}: {
  badge: string;
  title: React.ReactNode;
  sub: string;
}): React.ReactElement {
  return (
    <header className="mb-7 space-y-3">
      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-violet-400 font-medium">
        <Sparkles className="h-3.5 w-3.5" />
        {badge}
      </div>
      <h1 className="font-display text-3xl font-semibold text-zinc-100">{title}</h1>
      <p className="max-w-2xl text-sm text-[var(--color-app-muted)] leading-relaxed">{sub}</p>
    </header>
  );
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
      <motion.div
        animate={{ scale: active ? 1.05 : 1 }}
        className={[
          'h-7 w-7 rounded-full border flex items-center justify-center text-[11px] font-bold transition-all duration-300',
          done
            ? 'bg-emerald-500 border-emerald-400 text-emerald-950'
            : active
              ? 'bg-zinc-100 border-zinc-100 text-zinc-950'
              : 'bg-transparent border-[var(--color-app-border-strong)] text-[var(--color-app-muted)]',
        ].join(' ')}
      >
        {done ? '✓' : index}
      </motion.div>
      <span
        className={
          active || done
            ? 'text-zinc-100 text-sm font-medium'
            : 'text-[var(--color-app-muted)] text-sm'
        }
      >
        {label}
      </span>
    </div>
  );
}
