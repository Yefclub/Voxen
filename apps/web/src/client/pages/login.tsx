import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock } from '@/components/ui/icons';
import { motion } from 'motion/react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { InstanceState } from '../lib/types';
import { Logo } from '../components/ui/logo';
import { useI18n } from '../lib/i18n';
import { mcpOAuthSsoCallback } from '../lib/mcp-oauth-login';

/** Path relativo seguro para redirect pós-login (?next= ou state.from). */
function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (raw.includes('://')) return fallback;
  return raw;
}

function oauthQuery(search: string): string | undefined {
  const value = search.replace(/^\?/, '');
  return value.includes('sig=') ? value : undefined;
}

function continueOAuth(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const value = response as { url?: unknown; redirect_uri?: unknown };
  const raw = typeof value.url === 'string' ? value.url : value.redirect_uri;
  if (typeof raw !== 'string') return false;
  try {
    const target = new URL(raw, window.location.origin);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
    window.location.assign(target.toString());
    return true;
  } catch {
    return false;
  }
}

export function LoginPage(): React.ReactElement {
  const { setLocale, t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [instance, setInstance] = useState<InstanceState | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ssoError = params.get('error');
    if (ssoError === 'ACCOUNT_PENDING') {
      navigate('/pendente', { replace: true });
    } else if (ssoError === 'ACCOUNT_REJECTED') {
      setError(t('auth.ssoRejected'));
    } else if (ssoError === 'ACCOUNT_DISABLED') {
      setError(t('auth.ssoDisabled'));
    } else if (ssoError) {
      setError(t('auth.ssoError'));
    }
  }, [location.search, navigate, t]);

  function nextPath(): string {
    const fromState =
      typeof location.state === 'object' &&
      location.state !== null &&
      'from' in location.state &&
      typeof location.state.from === 'string'
        ? location.state.from
        : null;
    const fromQuery = new URLSearchParams(location.search).get('next');
    return safeNextPath(fromQuery ?? fromState, '/');
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiPost('/api/auth/sign-in/email', {
        email,
        password,
        oauth_query: oauthQuery(location.search),
      });
      await refresh();
      if (!continueOAuth(response)) navigate(nextPath());
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(t('auth.signInError'));
      } else {
        setError(t('auth.unexpectedError'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSso(): Promise<void> {
    if (!email.trim()) {
      setError(t('auth.ssoEmailRequired'));
      return;
    }
    setError(null);
    setSsoLoading(true);
    try {
      const pendingOAuthQuery = oauthQuery(location.search);
      const response = await apiPost<{ url: string; redirect: true }>('/api/auth/sign-in/sso', {
        email: email.trim(),
        loginHint: email.trim(),
        callbackURL: mcpOAuthSsoCallback(pendingOAuthQuery) ?? nextPath(),
        errorCallbackURL: pendingOAuthQuery ? `/entrar?${pendingOAuthQuery}` : '/entrar',
        newUserCallbackURL: '/pendente',
        providerType: 'oidc',
      });
      const target = new URL(response.url);
      if (target.protocol !== 'https:') throw new Error('Unsafe SSO redirect');
      window.location.assign(target.toString());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? t('auth.ssoNoProvider')
          : t('auth.ssoError'),
      );
      setSsoLoading(false);
    }
  }

  // Se não tem nenhum user ainda, manda direto pro cadastro (vira admin auto)
  const noUsersYet = instance && !instance.hasUsers;
  const canSignUp = instance?.allowSignups ?? true;

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr]">
      {/* Lado esquerdo: form */}
      <section className="flex flex-col items-center justify-center px-4 sm:px-8 lg:px-16 py-10 relative">
        {/* Mesh decorativa atrás */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 0% 0%, oklch(72% 0.18 290 / 0.06), transparent 70%), radial-gradient(ellipse 70% 50% at 100% 100%, oklch(73% 0.16 159 / 0.05), transparent 70%)',
          }}
        />
        <header className="absolute top-8 left-8 lg:left-16">
          <Logo size={32} />
        </header>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm space-y-7 relative"
        >
          {noUsersYet ? (
            <FirstRunCallout onContinue={() => navigate('/cadastro')} />
          ) : (
            <>
              <div className="space-y-2.5">
                <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.04em]">
                  {t('auth.signInTitle')}
                </h1>
                <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                  {t('auth.signInSubtitle')}
                </p>
              </div>

              <form className="space-y-5" onSubmit={onSubmit} noValidate>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <FieldLabel htmlFor="email">{t('auth.email')}</FieldLabel>
                <GlassInputWrapper>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                    className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)]"
                  />
                </GlassInputWrapper>

                <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
                <GlassInputWrapper>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full bg-transparent text-sm px-4 pr-11 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)] font-mono tracking-[0.2em]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)] transition-colors"
                      aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </GlassInputWrapper>

                <button
                  type="submit"
                  disabled={loading || ssoLoading}
                  className="w-full rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 py-3.5 font-semibold text-emerald-950 hover:from-emerald-300 hover:to-emerald-400 active:scale-[0.98] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? <Spinner /> : t('auth.signIn')}
                  {!loading && <ArrowRight className="h-4 w-4" />}
                </button>

                {instance?.ssoEnabled && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
                      <span className="h-px flex-1 bg-[var(--color-app-border)]" />
                      {t('auth.ssoSeparator')}
                      <span className="h-px flex-1 bg-[var(--color-app-border)]" />
                    </div>
                    <button
                      type="button"
                      disabled={loading || ssoLoading}
                      onClick={() => void onSso()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] py-3.5 text-sm font-semibold text-[var(--color-app-fg)] transition-colors hover:bg-[var(--color-app-surface-hover)] disabled:opacity-60"
                    >
                      {ssoLoading ? <Spinner /> : <KeyRound className="h-4 w-4" />}
                      {t('auth.ssoAction')}
                    </button>
                  </div>
                )}
              </form>

              {canSignUp && (
                <p className="text-center text-sm text-[var(--color-app-muted)] pt-2 border-t border-[var(--color-app-border)]/60">
                  {t('auth.noAccount')}{' '}
                  <Link
                    to="/cadastro"
                    className="text-violet-400 font-medium hover:text-violet-300 hover:underline transition-colors"
                  >
                    {t('auth.createAccount')}
                  </Link>
                </p>
              )}

              {!canSignUp && (
                <p className="text-center text-xs text-[var(--color-app-muted)] pt-2 border-t border-[var(--color-app-border)]/60 inline-flex items-center justify-center gap-1.5 w-full">
                  <Lock className="h-3 w-3" />
                  {t('auth.signupsClosed')}
                </p>
              )}
            </>
          )}
        </motion.div>
      </section>

      {/* Lado direito: hero painel */}
      <section className="hidden lg:block relative p-4">
        <HeroPanel />
      </section>
    </div>
  );
}

function FirstRunCallout({ onContinue }: { onContinue: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.04em]">
          {t('auth.firstRunTitle')}
        </h1>
        <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
          {t('auth.firstRunSubtitle')}
        </p>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="w-full rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 py-3.5 font-semibold text-emerald-950 hover:from-emerald-300 hover:to-emerald-400 active:scale-[0.98] inline-flex items-center justify-center gap-2"
      >
        {t('auth.createAdmin')}
        <ArrowRight className="h-4 w-4" />
      </button>
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
    <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] backdrop-blur-sm transition-colors focus-within:border-violet-400/60 focus-within:bg-violet-500/[0.06] focus-within:ring-2 focus-within:ring-violet-500/15">
      {children}
    </div>
  );
}

function HeroPanel(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="relative h-full rounded-3xl overflow-hidden">
      {/* Gradiente principal */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 20% 20%, oklch(72% 0.18 290 / 0.25), transparent 65%), radial-gradient(ellipse 70% 50% at 80% 80%, oklch(73% 0.16 159 / 0.18), transparent 70%), oklch(20% 0.005 250)',
        }}
      />
      {/* Grid blueprint */}
      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full opacity-[0.06] text-[var(--color-app-fg)]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid-hero" width="56" height="56" patternUnits="userSpaceOnUse">
            <path d="M 56 0 L 0 0 0 56" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-hero)" />
      </svg>

      {/* Logo gigante decorativa atrás */}
      <motion.img
        src="/voxen-512.png"
        alt=""
        aria-hidden
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.08 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
        className="absolute -right-20 -bottom-20 w-[640px] pointer-events-none select-none"
        draggable={false}
      />

      <div className="relative h-full flex flex-col justify-center px-12 xl:px-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-md space-y-6"
        >
          <h2 className="font-display text-5xl xl:text-6xl font-semibold leading-[0.98] tracking-[-0.04em] text-balance">
            {t('auth.heroTitle.prefix')}{' '}
            <span className="text-gradient">{t('auth.heroTitle.highlight')}</span>
          </h2>
          <p className="text-[15px] leading-relaxed text-[var(--color-app-subtle)] max-w-sm">
            {t('auth.heroSubtitle')}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
