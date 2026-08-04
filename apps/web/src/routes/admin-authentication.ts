import { resolveTxt } from 'node:dns/promises';
import { Hono, type Context } from 'hono';
import {
  createOidcProvider,
  disableOidcProvider,
  listOidcProviders,
  requestOidcDomainVerification,
  SsoProviderError,
  updateOidcProvider,
  verifyOidcDomains,
  type OidcProviderInput,
} from '../lib/sso-provider-service';

type Vars = { adminUserId: string };

export const adminAuthenticationRoutes = new Hono<{ Variables: Vars }>();

function badRequest(message: string): SsoProviderError {
  return new SsoProviderError(message);
}

function optionalScopes(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== 'string')) {
    throw badRequest('scopes deve ser uma lista de strings.');
  }
  return value;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw badRequest(`${field} é obrigatório.`);
  return value;
}

function parseCreate(body: Record<string, unknown>): OidcProviderInput {
  const domains = body.domains;
  if (
    typeof domains !== 'string' &&
    (!Array.isArray(domains) || domains.some((domain) => typeof domain !== 'string'))
  ) {
    throw badRequest('domains deve ser string ou lista de strings.');
  }
  if (body.pkce !== undefined && typeof body.pkce !== 'boolean') {
    throw badRequest('pkce deve ser boolean.');
  }
  if (body.pkce === false) throw badRequest('PKCE é obrigatório para provedores OIDC.');
  return {
    providerId: requiredString(body, 'providerId'),
    issuer: requiredString(body, 'issuer'),
    domains,
    clientId: requiredString(body, 'clientId'),
    clientSecret: requiredString(body, 'clientSecret'),
    pkce: body.pkce as boolean | undefined,
    scopes: optionalScopes(body.scopes),
  };
}

function parsePatch(body: Record<string, unknown>): Partial<Omit<OidcProviderInput, 'providerId'>> {
  const patch: Partial<Omit<OidcProviderInput, 'providerId'>> = {};
  for (const field of ['issuer', 'clientId', 'clientSecret'] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') throw badRequest(`${field} deve ser string.`);
      patch[field] = body[field] as string;
    }
  }
  if (body.domains !== undefined) {
    if (
      typeof body.domains !== 'string' &&
      (!Array.isArray(body.domains) || body.domains.some((domain) => typeof domain !== 'string'))
    ) {
      throw badRequest('domains deve ser string ou lista de strings.');
    }
    patch.domains = body.domains as string | string[];
  }
  if (body.pkce !== undefined) {
    if (typeof body.pkce !== 'boolean') throw badRequest('pkce deve ser boolean.');
    if (body.pkce === false) throw badRequest('PKCE é obrigatório para provedores OIDC.');
    patch.pkce = body.pkce;
  }
  if (body.scopes !== undefined) patch.scopes = optionalScopes(body.scopes);
  if (Object.keys(patch).length === 0) throw badRequest('Envie ao menos um campo para atualizar.');
  return patch;
}

function errorResponse(c: Context<{ Variables: Vars }>, error: unknown) {
  if (error instanceof SsoProviderError) return c.json({ error: error.message }, error.status);
  throw error;
}

adminAuthenticationRoutes.get('/providers', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ providers: await listOidcProviders() });
});

adminAuthenticationRoutes.post('/providers', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = await createOidcProvider(parseCreate(body), c.get('adminUserId'));
    c.header('Cache-Control', 'no-store');
    return c.json({ provider }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminAuthenticationRoutes.patch('/providers/:providerId', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = await updateOidcProvider(c.req.param('providerId'), parsePatch(body));
    c.header('Cache-Control', 'no-store');
    return c.json({ provider });
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminAuthenticationRoutes.delete('/providers/:providerId', async (c) => {
  try {
    await disableOidcProvider(c.req.param('providerId'));
    return c.json({ ok: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminAuthenticationRoutes.post('/providers/:providerId/domain-verification/request', async (c) => {
  try {
    const result = await requestOidcDomainVerification(c.req.param('providerId'));
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  } catch (error) {
    return errorResponse(c, error);
  }
});

adminAuthenticationRoutes.post('/providers/:providerId/domain-verification/verify', async (c) => {
  try {
    await verifyOidcDomains(c.req.param('providerId'), resolveTxt);
    return c.json({ verified: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});
