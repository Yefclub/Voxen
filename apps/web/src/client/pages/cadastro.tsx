import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { InstanceState } from '../lib/types';
import { Logo } from '../components/ui/logo';
import { cn } from '../lib/utils';

export function CadastroPage(): React.ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instance, setInstance] = useState<InstanceState | null>(null);
  const navigate = useNavigate();
  const { refresh } = useMe();

  useEffect(() => {
    apiGet<InstanceState>('/api/instance')
      .then(setInstance)
      .catch(() => undefined);
  }, []);

  const isFirstUser = instance && !instance.hasUsers;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('A senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/api/auth/sign-up/email', { name, email, password });
      await refresh();
      // Primeiro user = admin auto-aprovado. Logamos direto e mandamos pro onboarding.
      if (isFirstUser) {
        await apiPost('/api/auth/sign-in/email', { email, password });
        await refresh();
        navigate('/onboarding');
      } else {
        navigate('/entrar', { state: { justSignedUp: true } });
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const passwordStrength = checkStrength(password);

  return (
    <div className="min-h-screen flex flex-col px-8 lg:px-16 py-10 relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, oklch(73% 0.16 159 / 0.07), transparent 70%)',
        }}
      />
      <header className="mb-12">
        <Logo size={32} />
      </header>

      <main className="flex-1 flex items-center justify-center relative">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm space-y-7"
        >
          <div className="space-y-2.5">
            <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.04em]">
              {isFirstUser ? 'Criar conta principal' : 'Criar conta no Voxen'}
            </h1>
            <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
              {isFirstUser
                ? 'Esta será a conta administradora da instância.'
                : 'Você poderá usar a plataforma assim que o administrador aprovar.'}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <FieldLabel htmlFor="name">Nome</FieldLabel>
              <GlassInputWrapper>
                <input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Como prefere ser chamado"
                  autoComplete="name"
                  required
                  minLength={2}
                  className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-zinc-600"
                />
              </GlassInputWrapper>
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <GlassInputWrapper>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  autoComplete="email"
                  required
                  className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-zinc-600"
                />
              </GlassInputWrapper>
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="password">Senha</FieldLabel>
              <GlassInputWrapper>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 12 caracteres"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    className="w-full bg-transparent text-sm px-4 pr-11 py-3.5 rounded-xl focus:outline-none placeholder:text-zinc-600 font-mono tracking-[0.15em]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors"
                    aria-label={showPassword ? 'Ocultar senha' : 'Ver senha'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </GlassInputWrapper>
              {password.length > 0 && <StrengthBar strength={passwordStrength} />}
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="confirm">Confirmar senha</FieldLabel>
              <GlassInputWrapper>
                <div className="relative">
                  <input
                    id="confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repita a senha"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    className={cn(
                      'w-full bg-transparent text-sm px-4 pr-11 py-3.5 rounded-xl focus:outline-none placeholder:text-zinc-600 font-mono tracking-[0.15em]',
                      confirm.length > 0 && confirm !== password && 'text-rose-300',
                    )}
                  />
                  {confirm.length > 0 && confirm === password && (
                    <span className="absolute inset-y-0 right-3 flex items-center text-emerald-400">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </GlassInputWrapper>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 py-3.5 font-semibold text-emerald-950 hover:from-emerald-300 hover:to-emerald-400 active:scale-[0.98] inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? <Spinner /> : isFirstUser ? 'Criar e configurar' : 'Criar conta'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <p className="text-center text-sm text-[var(--color-app-muted)] pt-2 border-t border-[var(--color-app-border)]/60">
            Já tem conta?{' '}
            <Link
              to="/entrar"
              className="text-violet-400 font-medium hover:text-violet-300 hover:underline transition-colors"
            >
              Entrar
            </Link>
          </p>
        </motion.div>
      </main>
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
      className="block text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--color-app-muted)] mb-2"
    >
      {children}
    </label>
  );
}

function GlassInputWrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-[var(--color-app-border)] bg-zinc-100/[0.03] backdrop-blur-sm transition-colors focus-within:border-violet-400/60 focus-within:bg-violet-500/[0.06] focus-within:ring-2 focus-within:ring-violet-500/15">
      {children}
    </div>
  );
}

function checkStrength(pwd: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pwd.length === 0) return { score: 0, label: '' };
  let score = 0;
  if (pwd.length >= 12) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd) && /[^a-zA-Z\d]/.test(pwd)) score++;
  const labels = ['Fraca', 'Razoável', 'Boa', 'Forte'] as const;
  return { score: Math.min(score, 3) as 0 | 1 | 2 | 3, label: labels[score] ?? 'Forte' };
}

function StrengthBar({
  strength,
}: {
  strength: { score: 0 | 1 | 2 | 3; label: string };
}): React.ReactElement {
  const colors = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-400'];
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              i <= strength.score
                ? (colors[strength.score] ?? 'bg-zinc-700')
                : 'bg-[var(--color-app-border)]',
            )}
          />
        ))}
      </div>
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)] font-medium tabular-nums w-14 text-right">
        {strength.label}
      </span>
    </div>
  );
}
