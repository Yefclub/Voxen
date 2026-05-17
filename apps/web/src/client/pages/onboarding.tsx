import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Sparkles,
  Upload,
  Users,
  Lock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Spinner } from '../components/ui/spinner';
import { Logo } from '../components/ui/logo';
import { cn } from '../lib/utils';
import { ApiError, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { OrModel } from '../lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner as Spin } from '../components/ui/spinner';

interface ModelsResponse {
  chat: OrModel[];
  transcription: OrModel[];
}

type Step = 'key' | 'modelos' | 'modo' | 'perfil' | 'pronto';

export function OnboardingPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, refresh } = useMe();

  // Spinner SÓ no primeiro carregamento (data ainda null) — refetches
  // subsequentes (após upload de avatar, etc.) não devem desmontar o
  // wizard e resetar o state interno do <OnboardingContent>.
  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spin size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }
  if (data && !data.user) return <Navigate to="/entrar" replace />;
  if (data && data.user && data.user.status !== 'APPROVED')
    return <Navigate to="/pendente" replace />;
  if (data && data.user && data.user.role !== 'ADMIN')
    return <Navigate to="/dashboard" replace />;
  if (data?.onboardingDone) return <Navigate to="/dashboard" replace />;

  return (
    <OnboardingContent
      userName={data?.user?.name ?? ''}
      refresh={refresh}
      navigate={navigate}
    />
  );
}

function OnboardingContent({
  userName,
  refresh,
  navigate,
}: {
  userName: string;
  refresh: () => Promise<void>;
  navigate: ReturnType<typeof useNavigate>;
}): React.ReactElement {
  const [step, setStep] = useState<Step>('key');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [chatModel, setChatModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [allowSignups, setAllowSignups] = useState<boolean>(true);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submitKey(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiPost<ModelsResponse>('/api/setup/models', {
        openrouter_api_key: apiKey,
      });
      setModels(res);
      const whisper = res.transcription.find((m) => m.id.toLowerCase().includes('whisper'));
      // Default preferido: google/gemini-3.1-flash-lite. Cai em sonnet / primeiro.
      const preferred =
        res.chat.find((m) => m.id === 'google/gemini-3.1-flash-lite') ??
        res.chat.find(
          (m) => m.id.toLowerCase().includes('gemini') && m.id.toLowerCase().includes('flash'),
        ) ??
        res.chat.find((m) => m.id.toLowerCase().includes('sonnet'));
      setTranscriptionModel(whisper?.id ?? res.transcription[0]?.id ?? '');
      setChatModel(preferred?.id ?? res.chat[0]?.id ?? '');
      setStep('modelos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao validar chave.');
    } finally {
      setLoading(false);
    }
  }

  async function saveModels(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost('/api/setup', {
        openrouter_api_key: apiKey,
        default_chat_model: chatModel,
        default_transcription_model: transcriptionModel,
      });
      setStep('modo');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.');
    } finally {
      setLoading(false);
    }
  }

  function chooseModo(allow: boolean): void {
    setAllowSignups(allow);
    setStep('perfil');
  }

  async function uploadAvatar(file: File): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await fetch('/api/onboarding/avatar', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Erro ao enviar imagem.');
      }
      const data = (await res.json()) as { image: string };
      setAvatarPreview(data.image);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar imagem.');
    } finally {
      setLoading(false);
    }
  }

  async function finishOnboarding(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      await apiPost('/api/onboarding', { allow_signups: allowSignups });
      await refresh();
      setStep('pronto');
      setTimeout(() => navigate('/dashboard'), 1400);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao finalizar.');
    } finally {
      setLoading(false);
    }
  }

  const stepOrder: Step[] = ['key', 'modelos', 'modo', 'perfil'];
  const currentIdx = stepOrder.indexOf(step);

  if (step === 'pronto') {
    return (
      <FullScreenShell>
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 250, damping: 18 }}
          className="text-center"
        >
          <div className="relative inline-block">
            <div className="absolute inset-0 rounded-full bg-emerald-500/40 blur-2xl" />
            <div className="relative flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 border border-emerald-400/50">
              <CheckCircle2 className="h-7 w-7 text-emerald-950" strokeWidth={2.5} />
            </div>
          </div>
          <h2 className="font-display text-3xl font-semibold tracking-[-0.03em] mt-8">
            Tudo pronto, {userName.split(' ')[0]}.
          </h2>
          <p className="text-[15px] text-[var(--color-app-muted)] mt-3">Levando você ao painel…</p>
        </motion.div>
      </FullScreenShell>
    );
  }

  return (
    <FullScreenShell>
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <Logo size={28} withWordmark />
        </div>

        {/* Stepper */}
        <div className="mb-10 flex items-center gap-2.5">
          {stepOrder.map((s, i) => (
            <div key={s} className="flex items-center gap-2.5 flex-1">
              <StepDot active={i === currentIdx} done={i < currentIdx} index={i + 1} />
              {i < stepOrder.length - 1 && (
                <div className="flex-1 h-px relative">
                  <div className="absolute inset-0 bg-[var(--color-app-border)]" />
                  <motion.div
                    initial={false}
                    animate={{ scaleX: i < currentIdx ? 1 : 0 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 origin-left bg-gradient-to-r from-emerald-400 to-violet-400"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AnimatePresence mode="wait">
          {step === 'key' && (
            <Slide key="key">
              <Heading
                eyebrow="01 · Conexão"
                title="Conecte com a OpenRouter"
                sub="Uma chave dá acesso aos modelos de transcrição (Whisper) e ao agente que conversa com seu acervo."
              />
              <form onSubmit={submitKey} className="space-y-5">
                <FieldLabel htmlFor="key">OpenRouter API key</FieldLabel>
                <div className="rounded-xl border border-[var(--color-app-border)] bg-zinc-100/[0.03] backdrop-blur-sm focus-within:border-violet-400/60 focus-within:bg-violet-500/[0.06]">
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-app-muted)] pointer-events-none" />
                    <input
                      id="key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      autoComplete="off"
                      spellCheck={false}
                      required
                      minLength={20}
                      className="w-full bg-transparent text-sm pl-10 pr-4 py-3.5 rounded-xl focus:outline-none placeholder:text-zinc-600 font-mono"
                    />
                  </div>
                </div>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors"
                >
                  Não tem chave? Gerar agora
                  <ExternalLink className="h-3 w-3" />
                </a>
                <div className="flex justify-end pt-2">
                  <PrimaryButton type="submit" disabled={loading || apiKey.length < 20}>
                    {loading ? <Spinner /> : 'Validar e continuar'}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </PrimaryButton>
                </div>
              </form>
            </Slide>
          )}

          {step === 'modelos' && models && (
            <Slide key="modelos">
              <Heading
                eyebrow="02 · Modelos"
                title="Escolha os modelos padrão"
                sub="Whisper Large Turbo é a melhor relação custo/qualidade para transcrição. Para o chat, prefira modelos com contexto grande."
              />
              <form onSubmit={saveModels} className="space-y-5">
                <ModelSelect
                  label="Transcrição"
                  value={transcriptionModel}
                  onChange={setTranscriptionModel}
                  options={models.transcription}
                />
                <ModelSelect
                  label="Chat"
                  value={chatModel}
                  onChange={setChatModel}
                  options={models.chat}
                />
                <div className="flex justify-between pt-2">
                  <GhostButton type="button" onClick={() => setStep('key')}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Voltar
                  </GhostButton>
                  <PrimaryButton type="submit" disabled={loading}>
                    {loading ? <Spinner /> : 'Salvar e continuar'}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </PrimaryButton>
                </div>
              </form>
            </Slide>
          )}

          {step === 'modo' && (
            <Slide key="modo">
              <Heading
                eyebrow="03 · Modo de uso"
                title="Quem vai usar esta instância?"
                sub="Você pode mudar essa configuração depois nas configurações administrativas."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ModeCard
                  Icon={Users}
                  title="Equipe"
                  desc="Permitir que outros usuários se cadastrem (você aprova cada um)."
                  selected={allowSignups}
                  onClick={() => chooseModo(true)}
                />
                <ModeCard
                  Icon={Lock}
                  title="Apenas você"
                  desc="Fechar cadastros novos. Ninguém mais consegue criar conta."
                  selected={!allowSignups}
                  onClick={() => chooseModo(false)}
                />
              </div>
              <div className="flex justify-between pt-2 mt-6">
                <GhostButton type="button" onClick={() => setStep('modelos')}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar
                </GhostButton>
              </div>
            </Slide>
          )}

          {step === 'perfil' && (
            <Slide key="perfil">
              <Heading
                eyebrow="04 · Perfil (opcional)"
                title="Coloque sua cara nisso"
                sub="Adicione uma foto se quiser — ou pule e termine agora."
              />
              <div className="flex items-center gap-6 mb-6">
                <Avatar className="h-20 w-20 bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-[var(--color-app-border-strong)]">
                  {avatarPreview && (
                    <AvatarPrimitive.Image
                      src={avatarPreview}
                      alt={userName}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-transparent text-zinc-100 font-semibold text-2xl">
                    {userName
                      .split(/\s+/)
                      .map((p) => p[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] hover:bg-[var(--color-app-surface-hover)] px-3.5 py-2 text-sm font-medium transition-colors">
                    {loading ? <Spinner /> : <Upload className="h-3.5 w-3.5" />}
                    Enviar imagem
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadAvatar(f);
                      }}
                    />
                  </label>
                  <p className="text-xs text-[var(--color-app-muted)]">PNG, JPG ou WebP até 5MB</p>
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <GhostButton type="button" onClick={() => setStep('modo')}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar
                </GhostButton>
                <PrimaryButton type="button" onClick={finishOnboarding} disabled={loading}>
                  {loading ? <Spinner /> : 'Concluir'}
                  {!loading && <Sparkles className="h-4 w-4" />}
                </PrimaryButton>
              </div>
            </Slide>
          )}
        </AnimatePresence>
      </div>
    </FullScreenShell>
  );
}

function FullScreenShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, oklch(72% 0.18 290 / 0.08), transparent 70%)',
        }}
      />
      <div className="relative w-full flex justify-center">{children}</div>
    </div>
  );
}

function Slide({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-8"
    >
      {children}
    </motion.div>
  );
}

function Heading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}): React.ReactElement {
  return (
    <div className="mb-7 space-y-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-violet-400 font-medium">
        {eyebrow}
      </p>
      <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="text-[14px] text-[var(--color-app-muted)] leading-relaxed">{sub}</p>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--color-app-muted)]"
    >
      {children}
    </label>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OrModel[];
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={`select-${label}`}>{label}</FieldLabel>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] tabular-nums">
          {options.length} disponíveis
        </span>
      </div>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={`select-${label}`}>
          <SelectValue placeholder="Selecionar modelo…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <div className="flex flex-col py-0.5">
                <span className="font-medium">{m.name || m.id}</span>
                {m.name && m.name !== m.id && (
                  <span className="text-[11px] font-mono text-[var(--color-app-muted)]">
                    {m.id}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ModeCard({
  Icon,
  title,
  desc,
  selected,
  onClick,
}: {
  Icon: LucideIcon;
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded-xl border p-5 transition-all duration-200',
        selected
          ? 'border-violet-400/50 bg-violet-500/5 shadow-[0_0_0_1px_oklch(72%_0.18_290_/_0.4),0_8px_28px_-8px_oklch(72%_0.18_290_/_0.35)]'
          : 'border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] hover:border-[var(--color-app-border-strong)] hover:bg-[var(--color-app-surface-hover)]',
      )}
    >
      <div
        className={cn(
          'h-9 w-9 rounded-lg flex items-center justify-center mb-3 transition-colors',
          selected
            ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
            : 'bg-[var(--color-app-surface-hover)] text-[var(--color-app-muted)]',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="font-display text-base font-semibold tracking-tight mb-1">{title}</p>
      <p className="text-xs text-[var(--color-app-muted)] leading-relaxed">{desc}</p>
    </button>
  );
}

function StepDot({
  active,
  done,
  index,
}: {
  active: boolean;
  done: boolean;
  index: number;
}): React.ReactElement {
  return (
    <motion.div
      animate={{ scale: active ? 1.05 : 1 }}
      className={cn(
        'h-7 w-7 shrink-0 rounded-full border flex items-center justify-center text-[11px] font-bold transition-all duration-300',
        done
          ? 'bg-emerald-500 border-emerald-400 text-emerald-950'
          : active
            ? 'bg-zinc-100 border-zinc-100 text-zinc-950 shadow-[0_0_0_4px_oklch(72%_0.18_290_/_0.18)]'
            : 'bg-transparent border-[var(--color-app-border-strong)] text-[var(--color-app-muted)]',
      )}
    >
      {done ? '✓' : index}
    </motion.div>
  );
}

function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  return (
    <button
      {...props}
      className={cn(
        'rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 px-5 h-11 font-semibold text-emerald-950 hover:from-emerald-300 hover:to-emerald-400 transition-all shadow-[inset_0_1px_0_oklch(85%_0.18_159_/_0.6),0_8px_28px_-8px_oklch(73%_0.16_159_/_0.5)] active:scale-[0.98] inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  return (
    <button
      {...props}
      className="h-9 px-3.5 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--color-app-muted)] hover:text-zinc-100 rounded-md hover:bg-[var(--color-app-surface)] transition-colors"
    >
      {children}
    </button>
  );
}
