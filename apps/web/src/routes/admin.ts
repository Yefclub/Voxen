// ============================================================================
// Voxen — Admin routes
// ============================================================================
// Endpoints protegidos por role ADMIN:
//   - GET  /api/admin/usuarios               — lista todos
//   - POST /api/admin/usuarios/:id/approve   — aprova pendente
//   - POST /api/admin/usuarios/:id/reject    — rejeita pendente
//
// Auth guard: pega session, checa role===ADMIN. Senão 401/403.
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { getSetting, setSetting } from '../lib/settings';

type AdminVariables = {
  adminUserId: string;
};

export const adminRoutes = new Hono<{ Variables: AdminVariables }>();

// Middleware: require session + role ADMIN
adminRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Não autenticado.' }, 401);
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

// GET /api/admin/usuarios — lista todos
adminRoutes.get('/usuarios', async (c) => {
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      role: true,
      monthlyBudgetUsd: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  return c.json({ users });
});

// POST /api/admin/usuarios/:id/approve
adminRoutes.post('/usuarios/:id/approve', async (c) => {
  const id = c.req.param('id');
  const adminId = c.get('adminUserId');
  const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const monthlyBudgetUsd =
    typeof rawBody.monthlyBudgetUsd === 'number' ? rawBody.monthlyBudgetUsd : null;

  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json({ error: 'Usuário não encontrado.' }, 404);
  }
  if (user.status === 'APPROVED') {
    return c.json({ error: 'Usuário já aprovado.' }, 400);
  }

  const updated = await db.user.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: adminId,
      monthlyBudgetUsd,
    },
    select: { id: true, email: true, status: true, approvedAt: true },
  });
  return c.json({ user: updated });
});

// POST /api/admin/usuarios/:id/reject
adminRoutes.post('/usuarios/:id/reject', async (c) => {
  const id = c.req.param('id');
  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json({ error: 'Usuário não encontrado.' }, 404);
  }
  if (user.status === 'REJECTED') {
    return c.json({ error: 'Usuário já rejeitado.' }, 400);
  }
  const updated = await db.user.update({
    where: { id },
    data: { status: 'REJECTED' },
    select: { id: true, email: true, status: true },
  });
  return c.json({ user: updated });
});

// GET /api/admin/instance — estado da instância (allow_signups)
adminRoutes.get('/instance', async (c) => {
  const allowSignupsRaw = await getSetting('allow_signups').catch(() => null);
  return c.json({ allowSignups: allowSignupsRaw !== 'false' });
});

// PATCH /api/admin/instance — atualiza flag de cadastros abertos
adminRoutes.patch('/instance', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.allowSignups !== 'boolean') {
    return c.json({ error: 'Campo "allowSignups" obrigatório (boolean).' }, 400);
  }
  await setSetting('allow_signups', body.allowSignups ? 'true' : 'false');
  return c.json({ allowSignups: body.allowSignups });
});

// GET /api/admin/mcp — estado do MCP server (token configurado? qual user?).
// Não retorna o token bruto (não há "ver token de novo" — só rotacionar).
adminRoutes.get('/mcp', async (c) => {
  const stored = await getSetting('mcp_api_token').catch(() => null);
  if (!stored) {
    return c.json({ enabled: false, userId: null, tokenPreview: null });
  }
  const [userId, token] = stored.split(':');
  return c.json({
    enabled: !!(userId && token),
    userId: userId ?? null,
    tokenPreview: token ? token.slice(0, 8) + '…' : null,
  });
});

// POST /api/admin/mcp/rotate — gera novo token MCP pra o admin chamando.
// Retorna o token UMA vez (não é recuperável depois). Sobrescreve o anterior.
adminRoutes.post('/mcp/rotate', async (c) => {
  const adminUserId = c.get('adminUserId');
  // 32 bytes hex = 64 chars, entropia adequada pra Bearer token.
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await setSetting('mcp_api_token', `${adminUserId}:${token}`);
  return c.json({
    token,
    userId: adminUserId,
    warning: 'Salve este token agora — não será exibido novamente.',
  });
});

// DELETE /api/admin/mcp — revoga o token (apaga setting)
adminRoutes.delete('/mcp', async (c) => {
  const { deleteSetting } = await import('../lib/settings');
  await deleteSetting('mcp_api_token');
  return c.json({ ok: true });
});
