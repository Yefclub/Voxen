import { Hono } from 'hono';
import { auth, resolveMcpOAuthResource } from '../lib/auth';
import { db } from '../lib/db';
import { isMcpOAuthEnabled, MCP_OAUTH_SCOPES, writeMcpOAuthAudit } from '../lib/mcp-oauth';

type Vars = { userId: string };
export const mcpOAuthAccountRoutes = new Hono<{ Variables: Vars }>();

mcpOAuthAccountRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (user?.status !== 'APPROVED') return c.json({ error: 'Acesso negado.' }, 403);
  c.set('userId', session.user.id);
  return next();
});

mcpOAuthAccountRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const [enabled, grants] = await Promise.all([
    isMcpOAuthEnabled(),
    db.oauthConsent.findMany({
      where: { userId },
      select: {
        id: true,
        clientId: true,
        scopes: true,
        createdAt: true,
        updatedAt: true,
        oauthClient: {
          select: {
            name: true,
            uri: true,
            icon: true,
            disabled: true,
            redirectUris: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  return c.json({
    enabled,
    grants: grants.map((grant) => ({
      id: grant.id,
      clientId: grant.clientId,
      clientName: grant.oauthClient.name || 'OAuth client',
      clientUri: grant.oauthClient.uri,
      icon: grant.oauthClient.icon,
      disabled: grant.oauthClient.disabled === true,
      redirectHosts: grant.oauthClient.redirectUris.flatMap((value) => {
        try {
          return [new URL(value).host];
        } catch {
          return [];
        }
      }),
      scopes: grant.scopes,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
    })),
  });
});

mcpOAuthAccountRoutes.get('/consent-context', async (c) => {
  if (!(await isMcpOAuthEnabled())) {
    return c.json({ error: 'OAuth MCP não está habilitado nesta instância.' }, 503);
  }
  const clientId = c.req.query('client_id')?.trim() ?? '';
  const redirectUri = c.req.query('redirect_uri')?.trim() ?? '';
  const requestedScopes = [...new Set((c.req.query('scope') ?? '').split(/\s+/).filter(Boolean))];
  if (!clientId || !redirectUri || requestedScopes.length === 0) {
    return c.json({ error: 'Solicitação OAuth incompleta.' }, 400);
  }
  if (
    requestedScopes.some(
      (scope) => ![...MCP_OAUTH_SCOPES, 'offline_access'].includes(scope as never),
    )
  ) {
    return c.json({ error: 'Escopo OAuth não permitido.' }, 400);
  }
  const client = await db.oauthClient.findUnique({
    where: { clientId },
    select: { name: true, uri: true, icon: true, disabled: true, redirectUris: true },
  });
  if (!client || client.disabled || !client.redirectUris.includes(redirectUri)) {
    return c.json({ error: 'Cliente ou redirect URI OAuth inválido.' }, 400);
  }
  return c.json({
    clientId,
    clientName: client.name || 'OAuth client',
    clientUri: client.uri,
    icon: client.icon,
    redirectHost: new URL(redirectUri).host,
    resource: resolveMcpOAuthResource(),
    scopes: requestedScopes,
  });
});

mcpOAuthAccountRoutes.delete('/grants/:id', async (c) => {
  const userId = c.get('userId');
  const grant = await db.oauthConsent.findFirst({
    where: { id: c.req.param('id'), userId },
    select: { id: true, clientId: true },
  });
  if (!grant) return c.json({ error: 'Autorização OAuth não encontrada.' }, 404);

  await db.$transaction([
    db.oauthConsent.delete({ where: { id: grant.id } }),
    db.oauthRefreshToken.deleteMany({ where: { clientId: grant.clientId, userId } }),
    db.oauthAccessToken.deleteMany({ where: { clientId: grant.clientId, userId } }),
  ]);
  await writeMcpOAuthAudit({
    event: 'grant_revocation',
    outcome: 'success',
    actorUserId: userId,
    targetUserId: userId,
    clientId: grant.clientId,
  });
  return c.json({ ok: true });
});
