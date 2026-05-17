import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ExternalLink, KeyRound, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { apiPost, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { OrModel } from '../lib/types';

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
      // Sugere defaults: openai/whisper se existir, senão primeiro de cada
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
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Card>
          <CardContent className="pt-12 pb-12 flex flex-col items-center text-center space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Tudo pronto.</h2>
            <p className="text-sm text-zinc-400">
              Configuração salva. Redirecionando para o painel...
            </p>
            <Spinner />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-emerald-400 font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          Configuração inicial
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Conectar com a OpenRouter</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          O Voxen usa a OpenRouter como agregador único de LLMs. Uma chave dá acesso a Whisper para
          transcrição e a modelos de chat para o agente.{' '}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-zinc-300 hover:text-emerald-400 transition-colors"
          >
            Gerar chave
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {/* Stepper */}
      <div className="mb-8 flex items-center gap-4">
        <StepDot active={step === 'key'} done={step !== 'key'} label="Chave" />
        <div className="flex-1 h-px bg-zinc-800" />
        <StepDot
          active={step === 'modelos'}
          done={(step as 'modelos' | 'done') === 'done'}
          label="Modelos"
        />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'key' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-zinc-400" />
              Chave da API
            </CardTitle>
            <CardDescription>
              Cole sua chave do OpenRouter. Será validada agora e armazenada cifrada (AES-256-GCM)
              com a master key da instalação.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={validateAndListModels} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key">OPENROUTER API KEY</Label>
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
                  className="font-mono"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={loading}
                className="w-full"
              >
                {loading ? <Spinner /> : 'Validar e continuar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 'modelos' && models && (
        <Card>
          <CardHeader>
            <CardTitle>Modelos padrão</CardTitle>
            <CardDescription>
              Selecione um modelo de transcrição (áudio→texto) e um de chat (agente sobre o acervo).
              Cada user pode trocar depois nas configurações pessoais.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSetup} className="space-y-5">
              <ModelSelect
                label="Modelo de transcrição"
                value={transcriptionModel}
                onChange={setTranscriptionModel}
                options={models.transcription}
                hint="Whisper Large v3 Turbo é a melhor relação custo/qualidade hoje."
              />
              <ModelSelect
                label="Modelo de chat"
                value={chatModel}
                onChange={setChatModel}
                options={models.chat}
                hint="Use um modelo capaz com bom context window (Claude Sonnet, Gemini Pro)."
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
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          'h-6 w-6 rounded-full border flex items-center justify-center text-[10px] font-bold transition-all',
          done
            ? 'bg-emerald-500 border-emerald-500 text-emerald-950'
            : active
              ? 'bg-zinc-100 border-zinc-100 text-zinc-900'
              : 'bg-transparent border-zinc-700 text-zinc-500',
        ].join(' ')}
      >
        {done ? '✓' : label[0]}
      </div>
      <span
        className={active || done ? 'text-zinc-200 text-sm font-medium' : 'text-zinc-500 text-sm'}
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
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OrModel[];
  hint?: string;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15 transition-colors"
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
      {hint && <p className="text-xs text-zinc-500 leading-relaxed">{hint}</p>}
    </div>
  );
}
