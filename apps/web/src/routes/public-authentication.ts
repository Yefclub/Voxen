import { Hono } from 'hono';
import { auth, resolveMcpOAuthResource } from '../lib/auth';
import { clientIp, connectionPeerIp } from '../lib/client-ip';
import { db } from '../lib/db';
import { rateLimit, rateLimitRequired } from '../lib/rate-limit';
import { getAppLanguage, getSetting } from '../lib/settings';
import {
  authenticateMcpOAuthToken,
  isMcpOAuthAuthorityPath,
  isMcpOAuthEnabled,
  isValidMcpOAuthRedirect,
  recordMcpOAuthAccessTokenRevocation,
  writeMcpOAuthAudit,
  type McpOAuthAuditEventName,
} from '../lib/mcp-oauth';
import { isBlockedDirectSsoRoute } from '../lib/sso-oidc';
import { assertProviderRuntimeEndpointsPublic } from '../lib/sso-provider-service';
import { withSsoProviderRequest } from '../lib/sso-request-context';

export const publicAuthenticationRoutes = new Hono();

type OAuthAuditContext = {
  event: McpOAuthAuditEventName;
  clientId?: string;
  grantType?: 'authorization_code' | 'refresh_token';
  requestedScopes?: string[];
  denied?: boolean;
  revocationToken?: string;
  introspectionToken?: string;
};

function basicClientId(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Basic ')) return undefined;
  try {
    return (
      Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':', 1)[0] || undefined
    );
  } catch {
    return undefined;
  }
}

export function oauthResponseHasErrorRedirect(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get('location');
  if (!location) return false;
  try {
    return new URL(location, 'http://localhost').searchParams.has('error');
  } catch {
    return false;
  }
}

async function oauthAuditContext(
  c: Parameters<typeof clientIp>[0],
): Promise<OAuthAuditContext | null> {
  const url = new URL(c.req.url);
  const path = url.pathname;
  let values = new URLSearchParams(url.search);
  if (c.req.method !== 'GET') {
    const clone = c.req.raw.clone();
    const contentType = clone.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        const body = (await clone.json()) as Record<string, unknown>;
        values = new URLSearchParams(
          Object.entries(body).flatMap(([key, value]) =>
            typeof value === 'string' || typeof value === 'boolean'
              ? [[key, String(value)] as [string, string]]
              : [],
          ),
        );
      } else {
        values = new URLSearchParams(await clone.text());
      }
    } catch {
      values = new URLSearchParams();
    }
  }
  const signedOAuthQuery = values.get('oauth_query');
  if (signedOAuthQuery) {
    const signedValues = new URLSearchParams(signedOAuthQuery);
    for (const key of ['client_id', 'scope']) {
      const value = signedValues.get(key);
      if (value) values.set(key, value);
    }
  }
  const clientId =
    values.get('client_id')?.slice(0, 255) || basicClientId(c.req.header('authorization'));
  const requestedScopes = values.get('scope')?.split(/\s+/).filter(Boolean);
  if (path.endsWith('/oauth2/register')) return { event: 'client_registration', clientId };
  if (path.endsWith('/oauth2/authorize')) {
    return { event: 'authorization', clientId, requestedScopes };
  }
  if (path.endsWith('/oauth2/consent')) {
    return {
      event: 'consent',
      clientId,
      requestedScopes,
      denied: values.get('accept') === 'false',
    };
  }
  if (path.endsWith('/oauth2/token')) {
    const grantType = values.get('grant_type');
    return {
      event: grantType === 'refresh_token' ? 'token_refresh' : 'token_issuance',
      clientId,
      grantType:
        grantType === 'authorization_code' || grantType === 'refresh_token' ? grantType : undefined,
      requestedScopes,
    };
  }
  if (path.endsWith('/oauth2/revoke')) {
    return {
      event: 'token_revocation',
      clientId,
      revocationToken: values.get('token') || undefined,
    };
  }
  if (path.endsWith('/oauth2/introspect')) {
    return {
      event: 'token_introspection',
      clientId,
      introspectionToken: values.get('token') || undefined,
    };
  }
  return null;
}

publicAuthenticationRoutes.get('/api/instance', async (c) => {
  const [allowSignupsRaw, onboardingRaw, language, userCount, ssoProviderCount] = await Promise.all(
    [
      getSetting('allow_signups').catch(() => null),
      getSetting('onboarding_done').catch(() => null),
      getAppLanguage().catch(() => 'pt-BR' as const),
      db.user.count(),
      db.ssoProvider.count({
        where: { domainVerified: true, disabledAt: null, oidcConfig: { not: null } },
      }),
    ],
  );
  const onboardingDone = onboardingRaw === 'true';
  return c.json({
    allowSignups: userCount === 0 || (onboardingDone && allowSignupsRaw !== 'false'),
    hasUsers: userCount > 0,
    onboardingDone,
    language,
    ssoEnabled: ssoProviderCount > 0,
  });
});

publicAuthenticationRoutes.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const isOAuthAuthority = isMcpOAuthAuthorityPath(path);
  if (isOAuthAuthority && !(await isMcpOAuthEnabled())) {
    await writeMcpOAuthAudit({
      event: 'resource_rejection',
      outcome: 'denied',
      metadata: { reason: 'OAUTH_DISABLED', path },
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'temporarily_unavailable', error_description: 'MCP OAuth is disabled.' },
      503,
    );
  }
  if (path.endsWith('/oauth2/authorize')) {
    const resources = new URL(c.req.url).searchParams.getAll('resource');
    if (resources.length !== 1 || resources[0] !== resolveMcpOAuthResource()) {
      await writeMcpOAuthAudit({
        event: 'authorization',
        outcome: 'denied',
        metadata: { reason: 'RESOURCE_MISMATCH', path },
      });
      return c.json(
        {
          error: 'invalid_target',
          error_description: 'The OAuth resource must match the canonical Voxen MCP endpoint.',
        },
        400,
      );
    }
  }
  if (path.endsWith('/oauth2/register') && c.req.method === 'POST') {
    const peer = connectionPeerIp(c);
    let quotas;
    try {
      quotas = await Promise.all([
        rateLimitRequired(`voxen:rl:mcp-oauth:register:peer:${peer}`, 20, 3600),
        rateLimitRequired('voxen:rl:mcp-oauth:register:global', 200, 3600),
      ]);
    } catch {
      await writeMcpOAuthAudit({
        event: 'client_registration',
        outcome: 'failed',
        metadata: { reason: 'RATE_LIMIT_UNAVAILABLE', path },
      });
      c.header('Retry-After', '60');
      c.header('Cache-Control', 'no-store');
      return c.json(
        { error: 'temporarily_unavailable', error_description: 'OAuth rate limit unavailable.' },
        503,
      );
    }
    const exceeded = quotas.find((quota) => !quota.allowed);
    if (exceeded) {
      c.header('Retry-After', String(exceeded.resetIn));
      c.header('Cache-Control', 'no-store');
      return c.json(
        { error: 'temporarily_unavailable', error_description: 'OAuth rate limit exceeded.' },
        429,
      );
    }
  } else if (isOAuthAuthority) {
    const policy = path.endsWith('/oauth2/token')
      ? { limit: 120, window: 60, name: 'token' }
      : { limit: 60, window: 60, name: 'authorize' };
    const quota = await rateLimit(
      `voxen:rl:mcp-oauth:${policy.name}:${clientIp(c)}`,
      policy.limit,
      policy.window,
    ).catch(() => ({
      allowed: true,
      count: 0,
      limit: policy.limit,
      resetIn: policy.window,
    }));
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.resetIn));
      return c.json(
        { error: 'temporarily_unavailable', error_description: 'OAuth rate limit exceeded.' },
        429,
      );
    }
  }
  if (path.endsWith('/oauth2/register') && c.req.method === 'POST') {
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    const redirects = body?.redirect_uris;
    if (
      !Array.isArray(redirects) ||
      redirects.length === 0 ||
      redirects.length > 20 ||
      !redirects.every(isValidMcpOAuthRedirect)
    ) {
      await writeMcpOAuthAudit({
        event: 'client_registration',
        outcome: 'denied',
        metadata: { reason: 'INVALID_REDIRECT_URI', path },
      });
      return c.json(
        {
          error: 'invalid_redirect_uri',
          error_description:
            'Redirect URIs must be exact HTTPS URLs or exact HTTP loopback callbacks.',
        },
        400,
      );
    }
  }
  const auditContext = isOAuthAuthority ? await oauthAuditContext(c) : null;
  if (isBlockedDirectSsoRoute(path)) {
    return c.json({ error: 'Rota não encontrada.' }, 404);
  }
  const oidcCallback = path.match(/^\/api\/auth\/sso\/callback\/([^/]+)\/?$/);
  const oidcSignIn = /^\/api\/auth\/sign-in\/sso\/?$/.test(path);
  if (oidcSignIn) {
    // Redis is an abuse-control dependency, not an authentication dependency.
    // Keep SSO available during a cache outage and restore limits on recovery.
    const quota = await rateLimit(`voxen:rl:sso-sign-in:${clientIp(c)}`, 60, 60).catch(() => ({
      allowed: true,
      count: 0,
      limit: 60,
      resetIn: 60,
    }));
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.resetIn));
      return c.json({ error: 'Muitas tentativas de autenticação. Tente novamente em breve.' }, 429);
    }
  }
  if (oidcCallback?.[1]) {
    // Redis is an abuse-control dependency, not an authentication dependency.
    // The positive DNS cache still bounds repeated work if Redis is unavailable.
    const quota = await rateLimit(`voxen:rl:sso-callback:${clientIp(c)}`, 20, 60).catch(() => ({
      allowed: true,
      count: 0,
      limit: 20,
      resetIn: 60,
    }));
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.resetIn));
      return c.json({ error: 'Muitas tentativas de autenticação. Tente novamente em breve.' }, 429);
    }
    try {
      await assertProviderRuntimeEndpointsPublic(decodeURIComponent(oidcCallback[1]));
    } catch {
      return c.redirect('/entrar?error=SSO_ENDPOINT_UNAVAILABLE');
    }
  }
  if (path.startsWith('/api/auth/sign-up') && (await db.user.count()) > 0) {
    const [allowSignupsRaw, onboardingRaw] = await Promise.all([
      getSetting('allow_signups').catch(() => null),
      getSetting('onboarding_done').catch(() => null),
    ]);
    if (onboardingRaw === 'true' && allowSignupsRaw === 'false') {
      return c.json({ error: 'Cadastros novos estão desativados nesta instância.' }, 403);
    }
  }
  const actorSession = auditContext
    ? await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
    : null;
  let handlerRequest = c.req.raw;
  if (auditContext?.event === 'token_revocation') {
    const contentType = handlerRequest.headers.get('content-type') ?? '';
    const headers = new Headers(handlerRequest.headers);
    if (contentType.includes('application/json')) {
      const body = (await handlerRequest
        .clone()
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
      if (body) {
        delete body.token_type_hint;
        handlerRequest = new Request(handlerRequest.url, {
          method: handlerRequest.method,
          headers,
          body: JSON.stringify(body),
        });
      }
    } else {
      const body = new URLSearchParams(await handlerRequest.clone().text());
      body.delete('token_type_hint');
      handlerRequest = new Request(handlerRequest.url, {
        method: handlerRequest.method,
        headers,
        body,
      });
    }
  }
  let response = oidcCallback?.[1]
    ? await withSsoProviderRequest(decodeURIComponent(oidcCallback[1]), () =>
        auth.handler(handlerRequest),
      )
    : await auth.handler(handlerRequest);
  if (
    response.status < 400 &&
    auditContext?.event === 'token_revocation' &&
    auditContext.revocationToken &&
    auditContext.revocationToken.split('.').length === 3
  ) {
    try {
      await recordMcpOAuthAccessTokenRevocation(
        auditContext.revocationToken,
        auditContext.clientId,
      );
    } catch {
      response = Response.json(
        {
          error: 'temporarily_unavailable',
          error_description: 'Access-token revocation could not be persisted.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
      );
    }
  }
  let introspectionActive: boolean | undefined;
  if (
    response.status < 400 &&
    auditContext?.event === 'token_introspection' &&
    auditContext.introspectionToken?.split('.').length === 3
  ) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    if (body && typeof body.active === 'boolean') {
      introspectionActive = body.active;
      if (body.active && !(await authenticateMcpOAuthToken(auditContext.introspectionToken))) {
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        response = Response.json({ active: false }, { status: response.status, headers });
        introspectionActive = false;
      }
    }
  }
  if (auditContext) {
    await writeMcpOAuthAudit({
      event: auditContext.event,
      outcome:
        auditContext.denied === true || introspectionActive === false
          ? 'denied'
          : response.status >= 400 || oauthResponseHasErrorRedirect(response)
            ? 'failed'
            : 'success',
      actorUserId: actorSession?.user.id,
      targetUserId: actorSession?.user.id,
      clientId: auditContext.clientId,
      metadata: {
        grantType: auditContext.grantType,
        requestedScopes: auditContext.requestedScopes,
        path,
      },
    });
  }
  return response;
});
