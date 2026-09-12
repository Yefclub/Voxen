import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { KeyRound, ShieldCheck } from '@/components/ui/icons';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';

type ConsentContext = {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  icon: string | null;
  redirectHost: string;
  resource: string;
  scopes: string[];
};

type ConsentResponse = { redirect?: boolean; url?: string; redirect_uri?: string };

function safeRedirect(response: ConsentResponse): string | null {
  const raw = response.url ?? response.redirect_uri;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function OAuthConsentPage(): React.ReactElement {
  const { locale } = useI18n();
  const location = useLocation();
  const [context, setContext] = useState<ConsentContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<ConsentContext>(`/api/mcp/oauth/consent-context${location.search}`)
      .then((value) => {
        if (!cancelled) setContext(value);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof ApiError
              ? reason.message
              : locale === 'en'
                ? 'The authorization request is invalid or expired.'
                : 'A solicitação de autorização é inválida ou expirou.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale, location.search]);

  async function decide(accept: boolean): Promise<void> {
    setSubmitting(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const response = await apiPost<ConsentResponse>('/api/auth/oauth2/consent', {
        accept,
        oauth_query: location.search.replace(/^\?/, ''),
      });
      const target = safeRedirect(response);
      if (!target) throw new Error('Unsafe OAuth redirect');
      window.location.assign(target);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : locale === 'en'
            ? 'Could not complete authorization.'
            : 'Não foi possível concluir a autorização.',
      );
      setSubmitting(null);
    }
  }

  const scopeLabel = (scope: string): string => {
    if (scope === 'mcp:read') {
      return locale === 'en' ? 'Read your knowledge base' : 'Ler sua base de conhecimento';
    }
    if (scope === 'mcp:write') {
      return locale === 'en' ? 'Create and change content' : 'Criar e alterar conteúdo';
    }
    return locale === 'en' ? 'Keep access until revoked' : 'Manter acesso até a revogação';
  };

  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-xl items-center px-4 py-10">
      <Card elevated className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            {locale === 'en' ? 'Authorize MCP access' : 'Autorizar acesso MCP'}
          </CardTitle>
          <CardDescription>
            {locale === 'en'
              ? 'Review the client and permissions before sharing access to your Voxen workspace.'
              : 'Revise o cliente e as permissões antes de compartilhar acesso ao seu workspace Voxen.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!context && !error ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : context ? (
            <>
              <div className="rounded-xl border border-[var(--color-app-border)] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                    <KeyRound className="h-5 w-5 text-violet-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--color-app-fg)]">
                      {context.clientName}
                    </p>
                    <p className="truncate text-xs text-[var(--color-app-muted)]">
                      {context.redirectHost}
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-app-border)] px-3 py-2">
                <p className="text-xs text-[var(--color-app-muted)]">
                  {locale === 'en' ? 'Target resource' : 'Recurso de destino'}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--color-app-fg)]">
                  {context.resource}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
                  {locale === 'en' ? 'Requested permissions' : 'Permissões solicitadas'}
                </p>
                <ul className="space-y-2">
                  {context.scopes.map((scope) => (
                    <li
                      key={scope}
                      className="rounded-lg border border-[var(--color-app-border)] px-3 py-2 text-sm"
                    >
                      {scopeLabel(scope)} <span className="font-mono text-xs">({scope})</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
                {locale === 'en'
                  ? 'Access is isolated to your user and can be revoked from Account › MCP access. Voxen never sends your password to the client.'
                  : 'O acesso fica isolado ao seu usuário e pode ser revogado em Conta › Acesso MCP. O Voxen nunca envia sua senha ao cliente.'}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting !== null}
                  onClick={() => void decide(false)}
                >
                  {submitting === 'deny' ? <Spinner /> : null}
                  {locale === 'en' ? 'Deny' : 'Negar'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={submitting !== null}
                  onClick={() => void decide(true)}
                >
                  {submitting === 'allow' ? <Spinner /> : null}
                  {locale === 'en' ? 'Allow access' : 'Permitir acesso'}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
