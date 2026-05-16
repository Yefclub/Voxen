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
