import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { clientIp } from '../lib/client-ip';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import { getAppLanguage, getSetting } from '../lib/settings';
import { isBlockedDirectSsoRoute } from '../lib/sso-oidc';
import { assertProviderRuntimeEndpointsPublic } from '../lib/sso-provider-service';
import { withSsoProviderRequest } from '../lib/sso-request-context';

export const publicAuthenticationRoutes = new Hono();

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
  if (oidcCallback?.[1]) {
    return withSsoProviderRequest(decodeURIComponent(oidcCallback[1]), () =>
      auth.handler(c.req.raw),
    );
  }
  return auth.handler(c.req.raw);
});
