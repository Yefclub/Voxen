import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock } from '@/components/ui/icons';
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
import { useI18n } from '../lib/i18n';
import {
  mcpOAuthSsoCallback,
  mcpOAuthSsoErrorCallback,
  oauthContinuationUrl,
  pendingOAuthQuery,
} from '../lib/mcp-oauth-login';

/** Path relativo seguro para redirect pós-login (?next= ou state.from). */
function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (raw.includes('://')) return fallback;
  return raw;
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
    let leaving = false;
    try {
      const response = await apiPost('/api/auth/sign-in/email', {
        email,
        password,
        oauth_query: pendingOAuthQuery(location.search),
      });
      // An OAuth authorization continues on the server's URL right away;
      // refreshing the session first lets the app route to the library for a
      // moment, which is enough to lose the flow (e.g. an install prompt).
      const continuation = oauthContinuationUrl(response, window.location.origin);
      if (continuation) {
        leaving = true;
        window.location.assign(continuation);
        return;
      }
      await refresh();
      navigate(nextPath());
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(t('auth.signInError'));
      } else {
        setError(t('auth.unexpectedError'));
      }
    } finally {
      // Keep the spinner while the page leaves, so the form is not resubmitted.
      if (!leaving) setLoading(false);
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
      const pendingQuery = pendingOAuthQuery(location.search);
      const response = await apiPost<{ url: string; redirect: true }>('/api/auth/sign-in/sso', {
        email: email.trim(),
        loginHint: email.trim(),
        callbackURL: mcpOAuthSsoCallback(pendingQuery) ?? nextPath(),
        errorCallbackURL: mcpOAuthSsoErrorCallback(pendingQuery),
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
    <AuthFrame>
      {noUsersYet ? (
        <FirstRunCallout onContinue={() => navigate('/cadastro')} />
      ) : (
        <>
          <div className="space-y-2.5">
            <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] sm:text-[36px]">
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
            <AuthInputFrame>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                inputMode="email"
                enterKeyHint="next"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--color-app-muted)]"
              />
            </AuthInputFrame>

            <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
            <AuthInputFrame>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
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

            <Button
              variant="primary"
              type="submit"
              disabled={loading || ssoLoading}
              className="h-12 w-full"
            >
              {loading ? <Spinner /> : t('auth.signIn')}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>

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
                className="text-[var(--color-accent-primary)] font-medium hover:underline transition-colors"
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
    </AuthFrame>
  );
}

function FirstRunCallout({ onContinue }: { onContinue: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] sm:text-[36px]">
          {t('auth.firstRunTitle')}
        </h1>
        <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
          {t('auth.firstRunSubtitle')}
        </p>
      </div>
      <Button variant="primary" type="button" onClick={onContinue} className="h-12 w-full">
        {t('auth.createAdmin')}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
