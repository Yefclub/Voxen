import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  AtSign,
  Bot,
  CheckCircle2,
  DownloadCloud,
  ExternalLink,
  FileText,
  Globe2,
  Image,
  KeyRound,
  Mail,
  MessageSquareText,
  Mic2,
  Pencil,
  RotateCw,
  Sparkles,
  Timer,
  Wrench,
  type LucideIcon,
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
    cookies: boolean;
    proxies: boolean;
    userAgent: boolean;
    youtubeClients: boolean;
    poTokens: boolean;
  };
}

type Step = 'loading' | 'overview' | 'key' | 'modelos' | 'done';

export function SetupPage(): React.ReactElement {
  const [step, setStep] = useState<Step>('loading');
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keepExistingKey, setKeepExistingKey] = useState(true);
  const [chatModel, setChatModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [webSearchModel, setWebSearchModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [documentModel, setDocumentModel] = useState('');
  const [xAnalysisModel, setXAnalysisModel] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [summaryTimeoutSec, setSummaryTimeoutSec] = useState('');
  const [ytDlpCookies, setYtDlpCookies] = useState('');
  const [ytDlpProxyUrls, setYtDlpProxyUrls] = useState('');
  const [ytDlpUserAgent, setYtDlpUserAgent] = useState('');
  const [ytDlpYoutubeClients, setYtDlpYoutubeClients] = useState('');
  const [ytDlpYoutubePoTokens, setYtDlpYoutubePoTokens] = useState('');
  const [clearYtDlpCookies, setClearYtDlpCookies] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useMe();

  // Carrega estado atual ao montar
  useEffect(() => {
    apiGet<SetupStatus>('/api/setup')
      .then((s) => {
        setStatus(s);
        if (s.complete && s.chatModel) setChatModel(s.chatModel);
        if (s.complete && s.transcriptionModel) setTranscriptionModel(s.transcriptionModel);
        if (s.complete && s.webSearchModel) setWebSearchModel(s.webSearchModel);
        if (s.complete && s.visionModel) setVisionModel(s.visionModel);
        if (s.complete && s.documentModel) setDocumentModel(s.documentModel);
        if (s.complete && s.xAnalysisModel) setXAnalysisModel(s.xAnalysisModel);
        if (s.complete && s.adminEmail) setAdminEmail(s.adminEmail);
        if (s.complete && s.summaryTimeoutSec) setSummaryTimeoutSec(s.summaryTimeoutSec);
        setStep(s.complete ? 'overview' : 'key');
      })
      .catch(() => setStep('key'));
  }, []);

  async function loadModelsWithExistingKey(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost<ModelsResponse>('/api/setup/models', {});
      setModels(data);
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

  async function validateAndListModels(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost<ModelsResponse>('/api/setup/models', {
        openrouter_api_key: apiKey,
      });
      setModels(data);
      const whisper = data.transcription.find((m) => m.id.toLowerCase().includes('whisper'));
      const preferred =
        data.chat.find((m) => m.id === 'google/gemini-3.1-flash-lite') ??
        data.chat.find(
          (m) => m.id.toLowerCase().includes('gemini') && m.id.toLowerCase().includes('flash'),
        ) ??
        data.chat.find((m) => m.id.toLowerCase().includes('sonnet'));
      if (!transcriptionModel) {
        setTranscriptionModel(whisper?.id ?? data.transcription[0]?.id ?? '');
      }
      if (!chatModel) setChatModel(preferred?.id ?? data.chat[0]?.id ?? '');
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

  async function saveSetup(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
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
      if (ytDlpProxyUrls.trim()) body.yt_dlp_proxy_urls = ytDlpProxyUrls;
      if (ytDlpUserAgent.trim()) body.yt_dlp_user_agent = ytDlpUserAgent;
      if (ytDlpYoutubeClients.trim()) body.yt_dlp_youtube_clients = ytDlpYoutubeClients;
      if (ytDlpYoutubePoTokens.trim()) body.yt_dlp_youtube_po_tokens = ytDlpYoutubePoTokens;
      if (ytDlpCookies.trim()) body.yt_dlp_cookies_txt = ytDlpCookies;
      if (clearYtDlpCookies) body.clear_yt_dlp_cookies = true;
      // Só envia api_key se for nova (admin escolheu trocar)
      if (apiKey && !keepExistingKey) {
        body.openrouter_api_key = apiKey;
      } else if (apiKey && !status?.complete) {
        body.openrouter_api_key = apiKey;
      }
      await apiPost('/api/setup', body);
      await refresh();
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

  // Overview: setup já existe — mostra valores e oferece edição
  if (step === 'overview' && status) {
    const mediaItems = getMediaExtractionItems(status.ytDlp);

    return (
      <AnimatedPage>
        <div className="mx-auto max-w-5xl px-6 py-10">
          <PageHeader
            badge="Configuração"
            title="Configuração da instância"
            sub="OpenRouter conectado. Ajuste modelos, operação e resiliência de extração por área."
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <ConfigGroup
                title="Modelos de IA"
                description="Padrões usados pelas filas, chat, uploads e análise de links."
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <ConfigItem
                    icon={MessageSquareText}
                    label="Chat"
                    value={status.chatModel}
                    required
                    mono
                  />
                  <ConfigItem
                    icon={Mic2}
                    label="Transcrição"
                    value={status.transcriptionModel}
                    required
                    mono
                  />
                  <ConfigItem
                    icon={Globe2}
                    label="Pesquisa web"
                    value={status.webSearchModel}
                    fallback="Usa o modelo de chat"
                    mono
                  />
                  <ConfigItem
                    icon={Image}
                    label="Visão"
                    value={status.visionModel}
                    fallback="Uploads de imagem desativados"
                    mono
                  />
                  <ConfigItem
                    icon={FileText}
                    label="Documentos/PDF"
                    value={status.documentModel}
                    fallback="Uploads de documentos desativados"
                    mono
                  />
                  <ConfigItem
                    icon={Bot}
                    label="Análise do X"
                    value={status.xAnalysisModel}
                    fallback="Sem modelo Grok dedicado"
                    mono
                  />
                </div>
              </ConfigGroup>

              <ConfigGroup
                title="Operação"
                description="Parâmetros administrativos que afetam scraping, resumos e suporte."
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <ConfigItem
                    icon={AtSign}
                    label="Email do operador"
                    value={status.adminEmail}
                    fallback="Não configurado"
                  />
                  <ConfigItem
                    icon={Timer}
                    label="Timeout de resumo"
                    value={status.summaryTimeoutSec ? `${status.summaryTimeoutSec}s` : null}
                    fallback="Padrão do serviço"
                  />
                </div>
              </ConfigGroup>
            </div>

            <aside className="space-y-4">
              <Card elevated>
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">OpenRouter</CardTitle>
                      <CardDescription>Chave ativa e armazenada cifrada.</CardDescription>
                    </div>
                    <Badge variant="success">Cifrada</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/45 px-3 py-2 font-mono text-sm text-zinc-200">
                    <KeyRound className="h-4 w-4 text-emerald-400" />
                    <span className="truncate">••••••••••••••••••••</span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
                    A chave nunca é exibida de volta pela API.
                  </p>
                </CardContent>
              </Card>

              <Card elevated>
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">Extração de mídia</CardTitle>
                      <CardDescription>
                        Estratégias adicionais para ambientes restritos.
                      </CardDescription>
                    </div>
                    <Wrench className="mt-0.5 h-4 w-4 text-[var(--color-app-muted)]" />
                  </div>
                </CardHeader>
                <CardContent>
                  {mediaItems.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {mediaItems.map((item) => (
                        <Badge key={item} variant="success">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--color-app-border)] px-3 py-3 text-sm text-[var(--color-app-muted)]">
                      Nenhuma estratégia extra configurada.
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-app-muted)]">
                Altere modelos ou substitua a chave quando mudar de provedor, custo ou capacidade.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => {
                    setKeepExistingKey(true);
                    void loadModelsWithExistingKey();
                  }}
                  disabled={loading}
                >
                  {loading ? <Spinner /> : <Pencil className="h-3.5 w-3.5" />}
                  Trocar modelos
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => {
                    setKeepExistingKey(false);
                    setStep('key');
                    setApiKey('');
                  }}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Substituir chave
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </AnimatedPage>
    );
  }

  // Wizard (primeira vez OU trocar chave)
  return (
    <AnimatedPage>
      <div className="mx-auto max-w-3xl px-6 py-12">
        <PageHeader
          badge={status?.complete ? 'Substituir chave' : 'Configuração inicial'}
          title={
            status?.complete ? (
              'Trocar chave da OpenRouter'
            ) : (
              <>
                Conecte com a <span className="text-emerald-accent">OpenRouter</span>
              </>
            )
          }
          sub={
            status?.complete
              ? 'A chave antiga será sobrescrita após validação.'
              : 'Uma chave da OpenRouter dá acesso a Whisper para transcrição e a vários modelos de chat. É a única dependência externa do Voxen.'
          }
        />

        {/* Stepper */}
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
          <StepDot
            index={2}
            active={step === 'modelos'}
            done={(step as Step) === 'done'}
            label="Modelos"
          />
        </div>

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
                    {status?.complete ? 'Substituir chave' : 'Cole sua chave'}
                  </CardTitle>
                  <CardDescription>
                    {status?.complete ? (
                      <>
                        Há uma chave configurada. Cole uma nova para substituir, ou{' '}
                        <button
                          type="button"
                          onClick={() => setStep('overview')}
                          className="text-zinc-100 underline-offset-4 hover:text-emerald-400 hover:underline transition-colors"
                        >
                          mantenha a atual
                        </button>
                        .
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {status?.complete && (
                    <div className="mb-4 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="text-xs text-emerald-200">Chave atual ativa.</span>
                      <span className="ml-auto font-mono text-[11px] tracking-widest text-emerald-300/80">
                        ••••••••••••
                      </span>
                    </div>
                  )}
                  <form onSubmit={validateAndListModels} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="key">
                        {status?.complete ? 'Nova chave' : 'OpenRouter API key'}
                      </Label>
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
                      {status?.complete && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setStep('overview')}
                        >
                          Cancelar
                        </Button>
                      )}
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        disabled={loading}
                        className={status?.complete ? '' : 'w-full h-11'}
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
                          Use cookies Netscape, proxies próprios e user-agent real quando
                          plataformas aplicarem soft-block no servidor. Não use proxies públicos
                          aleatórios.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Cookies Netscape</Label>
                        <textarea
                          value={ytDlpCookies}
                          onChange={(e) => {
                            setYtDlpCookies(e.target.value);
                            if (e.target.value.trim()) setClearYtDlpCookies(false);
                          }}
                          placeholder="# Netscape HTTP Cookie File…"
                          rows={4}
                          spellCheck={false}
                          className="min-h-24 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60"
                        />
                        {status?.ytDlp?.cookies && (
                          <label className="flex items-center gap-2 text-xs text-[var(--color-app-muted)]">
                            <input
                              type="checkbox"
                              checked={clearYtDlpCookies}
                              onChange={(e) => setClearYtDlpCookies(e.target.checked)}
                            />
                            Remover cookies salvos
                          </label>
                        )}
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Proxies próprios</Label>
                          <textarea
                            value={ytDlpProxyUrls}
                            onChange={(e) => setYtDlpProxyUrls(e.target.value)}
                            placeholder="http://usuario:senha@host:porta&#10;socks5://host:porta"
                            rows={3}
                            spellCheck={false}
                            className="min-h-20 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>User-Agent</Label>
                          <Input
                            value={ytDlpUserAgent}
                            onChange={(e) => setYtDlpUserAgent(e.target.value)}
                            placeholder="Mozilla/5.0 …"
                            className="font-mono text-xs"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Clientes YouTube</Label>
                          <Input
                            value={ytDlpYoutubeClients}
                            onChange={(e) => setYtDlpYoutubeClients(e.target.value)}
                            placeholder="web,mweb"
                            className="font-mono text-xs"
                          />
                          <p className="text-[11px] text-[var(--color-app-muted)] leading-snug">
                            Vazio usa a estratégia padrão do extrator. Preencha só para testar
                            clientes específicos.
                          </p>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>PO Tokens YouTube</Label>
                          <textarea
                            value={ytDlpYoutubePoTokens}
                            onChange={(e) => setYtDlpYoutubePoTokens(e.target.value)}
                            placeholder="mweb.gvs+TOKEN&#10;web.subs+TOKEN"
                            rows={3}
                            spellCheck={false}
                            className="min-h-20 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60"
                          />
                          <p className="text-[11px] text-[var(--color-app-muted)] leading-snug">
                            Use com provider/gerador de PO Token quando o YouTube exigir prova de
                            origem para GVS, player ou legendas.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (status?.complete && !apiKey) {
                        setStep('overview');
                      } else {
                        setStep('key');
                      }
                      setError(null);
                    }}
                  >
                    Voltar
                  </Button>
                  <Button type="submit" variant="primary" size="lg" disabled={loading}>
                    {loading ? <Spinner /> : 'Salvar e continuar'}
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

function ConfigGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Card elevated>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ConfigItem({
  icon: Icon,
  label,
  value,
  fallback,
  mono,
  required,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
  fallback?: string;
  mono?: boolean;
  required?: boolean;
}): React.ReactElement {
  const configured = !!value;
  return (
    <div className="flex min-h-[76px] items-start gap-3 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/35 px-3 py-3">
      <div
        className={[
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
          configured
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
            : 'border-zinc-700/70 bg-zinc-900/70 text-[var(--color-app-muted)]',
        ].join(' ')}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
            {label}
          </p>
          {required && (
            <Badge variant="outline" className="px-2 py-0 text-[10px]">
              Obrigatório
            </Badge>
          )}
          {!required && !configured && (
            <Badge variant="muted" className="px-2 py-0 text-[10px]">
              Opcional
            </Badge>
          )}
        </div>
        <p
          className={[
            'truncate text-sm',
            configured
              ? mono
                ? 'font-mono text-zinc-100'
                : 'text-zinc-100'
              : 'text-[var(--color-app-muted)]',
          ].join(' ')}
          title={value ?? fallback ?? undefined}
        >
          {value ?? fallback ?? 'Não configurado'}
        </p>
      </div>
    </div>
  );
}

function getMediaExtractionItems(status: SetupStatus['ytDlp']): string[] {
  if (!status) return [];
  return [
    status.cookies ? 'cookies Netscape' : null,
    status.proxies ? 'proxies próprios' : null,
    status.userAgent ? 'user-agent real' : null,
    status.youtubeClients ? 'clientes YouTube' : null,
    status.poTokens ? 'PO Tokens' : null,
  ].filter((item): item is string => Boolean(item));
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
