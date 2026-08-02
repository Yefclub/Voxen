// Gestão de tokens MCP pelo próprio dono. Segredos só aparecem nesta resposta
// de criação; listagens retornam exclusivamente metadados não sensíveis.
import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { createMcpToken, parseMcpScopes, toMcpTokenMetadata } from '../lib/mcp-tokens';
import { getSetting } from '../lib/settings';

type Vars = { userId: string; isAdmin: boolean };
export const mcpTokenRoutes = new Hono<{ Variables: Vars }>();

mcpTokenRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, role: true },
  });
  if (!user || user.status !== 'APPROVED') return c.json({ error: 'Acesso negado.' }, 403);
  c.set('userId', session.user.id);
  c.set('isAdmin', user.role === 'ADMIN');
  return next();
});

mcpTokenRoutes.get('/', async (c) => {
  const tokens = await db.mcpToken.findMany({
    where: { userId: c.get('userId') },
    orderBy: { createdAt: 'desc' },
  });
  return c.json({ tokens: tokens.map(toMcpTokenMetadata) });
});

mcpTokenRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const scopes = parseMcpScopes(body.scopes);
  if (!label || label.length > 100)
    return c.json({ error: 'Rótulo deve ter entre 1 e 100 caracteres.' }, 400);
  if (!scopes) return c.json({ error: 'Escopos MCP inválidos.' }, 400);
  const expiresAt = parseExpiry(body.expiresAt);
  if (expiresAt === undefined)
    return c.json({ error: 'Data de expiração inválida ou no passado.' }, 400);
  const enabled = (await getSetting('mcp_user_tokens_enabled').catch(() => null)) === 'true';
  if (!enabled && !c.get('isAdmin')) {
    return c.json({ error: 'A criação de tokens MCP por usuários está desabilitada.' }, 403);
  }
  const created = await createMcpToken({ userId: c.get('userId'), label, scopes, expiresAt });
  c.header('Cache-Control', 'no-store');
  return c.json(created, 201);
});

mcpTokenRoutes.delete('/:id', async (c) => {
  const result = await db.mcpToken.updateMany({
    where: { id: c.req.param('id'), userId: c.get('userId'), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return c.json({ error: 'Token não encontrado ou já revogado.' }, 404);
  return c.json({ ok: true });
});

function parseExpiry(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date <= new Date() ? undefined : date;
}
