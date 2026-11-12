import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff } from '@/components/ui/icons';
import {
  AuthFrame,
  AuthFieldLabel as FieldLabel,
  AuthInputFrame,
} from '../components/layout/auth-frame';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { InstanceState } from '../lib/types';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

export function CadastroPage(): React.ReactElement {
  const { setLocale, t } = useI18n();
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
    // Guarda contra setState após unmount (apiGet não aceita AbortController).
    let cancelled = false;
    apiGet<InstanceState>('/api/instance')
      .then((next) => {
        if (cancelled) return;
        setInstance(next);
        setLocale(next.language);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setLocale]);

  const isFirstUser = instance && !instance.hasUsers;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(t('signup.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('signup.passwordMismatch'));
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
      else setError(t('auth.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }

  const passwordStrength = checkStrength(password, [
    t('signup.strength.weak'),
    t('signup.strength.fair'),
    t('signup.strength.good'),
    t('signup.strength.strong'),
  ]);

  return (
    <AuthFrame>
      <div className="space-y-2.5">
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] sm:text-[36px]">
          {isFirstUser ? t('signup.titleFirst') : t('signup.titleDefault')}
        </h1>
        <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
          {isFirstUser ? t('signup.subtitleFirst') : t('signup.subtitleDefault')}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <FieldLabel htmlFor="name">{t('auth.name')}</FieldLabel>
          <AuthInputFrame>
            <input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.namePlaceholder')}
              autoComplete="name"
              required
              minLength={2}
              className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)]"
            />
          </AuthInputFrame>
        </div>

        <div className="space-y-2">
          <FieldLabel htmlFor="email">{t('auth.email')}</FieldLabel>
          <AuthInputFrame>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
              required
              className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)]"
            />
          </AuthInputFrame>
        </div>

        <div className="space-y-2">
          <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
          <AuthInputFrame>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordMin')}
                autoComplete="new-password"
                minLength={12}
                required
                className="w-full bg-transparent text-sm px-4 pr-11 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] transition-colors"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </AuthInputFrame>
          {password.length > 0 && <StrengthBar strength={passwordStrength} />}
        </div>

        <div className="space-y-2">
          <FieldLabel htmlFor="confirm">{t('auth.passwordConfirm')}</FieldLabel>
          <AuthInputFrame>
            <div className="relative">
              <input
                id="confirm"
                name="confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('auth.passwordConfirm')}
                autoComplete="new-password"
                minLength={12}
                required
                className={cn(
                  'w-full bg-transparent text-sm px-4 pr-11 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)]',
                  confirm.length > 0 && confirm !== password && 'text-[var(--color-app-danger)]',
                )}
              />
              {confirm.length > 0 && confirm === password && (
                <span className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-app-success-fg)]">
                  <Check className="h-4 w-4" />
                </span>
              )}
            </div>
          </AuthInputFrame>
        </div>

        <Button variant="primary" type="submit" disabled={loading} className="h-12 w-full">
          {loading ? (
            <Spinner />
          ) : isFirstUser ? (
            t('signup.submitFirst')
          ) : (
            t('signup.submitDefault')
          )}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="text-center text-sm text-[var(--color-app-muted)] pt-2 border-t border-[var(--color-app-border)]/60">
        {t('signup.hasAccount')}{' '}
        <Link
          to="/entrar"
          className="text-[var(--color-accent-primary)] font-medium hover:underline transition-colors"
        >
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthFrame>
  );
}

function checkStrength(
  pwd: string,
  labels: readonly [string, string, string, string],
): { score: 0 | 1 | 2 | 3; label: string } {
  if (pwd.length === 0) return { score: 0, label: '' };
  let score = 0;
  if (pwd.length >= 12) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd) && /[^a-zA-Z\d]/.test(pwd)) score++;
  return { score: Math.min(score, 3) as 0 | 1 | 2 | 3, label: labels[score] ?? labels[3] };
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
                ? (colors[strength.score] ?? 'bg-[var(--color-app-border-strong)]')
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
