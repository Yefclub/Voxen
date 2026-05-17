import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ExternalLink, KeyRound, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { OrModel } from '../lib/types';
import { AnimatedPage } from '../components/motion/animated-page';

interface ModelsResponse {
  chat: OrModel[];
  transcription: OrModel[];
}

export function SetupPage(): React.ReactElement {
  const [step, setStep] = useState<'key' | 'modelos' | 'done'>('key');
  const [apiKey, setApiKey] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useMe();

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
      const sonnet = data.chat.find((m) => m.id.toLowerCase().includes('sonnet'));
      setTranscriptionModel(whisper?.id ?? data.transcription[0]?.id ?? '');
      setChatModel(sonnet?.id ?? data.chat[0]?.id ?? '');
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
      await apiPost('/api/setup', {
        openrouter_api_key: apiKey,
        default_chat_model: chatModel,
        default_transcription_model: transcriptionModel,
      });
      await refresh();
      setStep('done');
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <AnimatedPage>
        <div className="mx-auto max-w-2xl px-6 py-20 flex flex-col items-center text-center">
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
            className="font-display text-3xl font-semibold tracking-[-0.03em] mt-8"
          >
            Tudo pronto.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="text-[15px] text-[var(--color-app-muted)] mt-3"
          >
            Configuração salva. Levando você ao painel…
          </motion.p>
          <div className="mt-6">
            <Spinner className="text-emerald-400" />
          </div>
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-10 space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-violet-400 font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            Configuração inicial
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">
            Conecte com a <span className="text-emerald-accent">OpenRouter</span>
          </h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
            Uma chave da OpenRouter dá acesso a Whisper para transcrição e a vários modelos de chat.
            É a única dependência externa do Voxen.{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-100 underline-offset-4 hover:text-emerald-400 hover:underline transition-colors"
            >
              Gerar chave
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </header>

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
            done={(step as 'modelos' | 'done') === 'done'}
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
                    Cole sua chave
                  </CardTitle>
                  <CardDescription>
                    Será validada agora contra a OpenRouter e armazenada{' '}
                    <span className="text-zinc-200">cifrada em AES-256-GCM</span> com a master key
                    da instalação. Não vai para o disco em texto puro.
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
              <Card elevated>
                <CardHeader>
                  <CardTitle className="font-display">Modelos padrão</CardTitle>
                  <CardDescription>
                    Whisper Large v3 Turbo costuma ser a melhor relação custo/qualidade para
                    transcrição. Para o chat, prefira modelos com contexto grande (Sonnet, Gemini
                    Pro).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveSetup} className="space-y-5">
                    <ModelSelect
                      label="Modelo de transcrição"
                      value={transcriptionModel}
                      onChange={setTranscriptionModel}
                      options={models.transcription}
                      count={models.transcription.length}
                    />
                    <ModelSelect
                      label="Modelo de chat"
                      value={chatModel}
                      onChange={setChatModel}
                      options={models.chat}
                      count={models.chat.length}
                    />
                    <div className="flex justify-end gap-3 pt-2">
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
                      <Button type="submit" variant="primary" size="lg" disabled={loading}>
                        {loading ? <Spinner /> : 'Salvar e continuar'}
                        {!loading && <ArrowRight className="h-4 w-4" />}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AnimatedPage>
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
        animate={{
          scale: active ? 1.05 : 1,
        }}
        className={[
          'h-7 w-7 rounded-full border flex items-center justify-center text-[11px] font-bold transition-all duration-300',
          done
            ? 'bg-emerald-500 border-emerald-400 text-emerald-950'
            : active
              ? 'bg-zinc-100 border-zinc-100 text-zinc-950 shadow-[0_0_0_4px_oklch(72%_0.18_290_/_0.18)]'
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

function ModelSelect({
  label,
  value,
  onChange,
  options,
  count,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OrModel[];
  count: number;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] tabular-nums">
          {count} disponíveis
        </span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-11 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[oklch(72%_0.18_290_/_0.6)] focus:ring-2 focus:ring-[oklch(72%_0.18_290_/_0.15)] transition-colors"
        required
      >
        <option value="" disabled>
          Selecionar modelo…
        </option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name || m.id}
          </option>
        ))}
      </select>
    </div>
  );
}
