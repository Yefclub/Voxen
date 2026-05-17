// ============================================================================
// /api/account — perfil do user logado
// ============================================================================
// GET    /api/account            — dados completos (name, email, image)
// PATCH  /api/account            — atualizar name (email é imutável aqui)
// POST   /api/account/password   — trocar senha (precisa da senha atual)
// O upload de avatar reaproveita /api/onboarding/avatar (qualquer user).
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';

type Vars = { userId: string };

export const accountRoutes = new Hono<{ Variables: Vars }>();

accountRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  c.set('userId', session.user.id);
  return next();
});

accountRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      status: true,
      monthlyBudgetUsd: true,
      createdAt: true,
    },
  });
  return c.json({ user: u });
});

const PatchBody = z.object({
  name: z.string().min(2).max(100),
});

accountRoutes.patch('/', async (c) => {
  const userId = c.get('userId');
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Nome inválido (mínimo 2 caracteres).' }, 400);
  }
  const u = await db.user.update({
    where: { id: userId },
    data: { name: parsed.data.name.trim() },
    select: { id: true, name: true, email: true, image: true },
  });
  return c.json({ user: u });
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

accountRoutes.post('/password', async (c) => {
  const parsed = PasswordBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido (nova senha mínimo 12 chars).' }, 400);
  }
  // better-auth tem changePassword via API server
  try {
    await auth.api.changePassword({
      headers: c.req.raw.headers,
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
    });
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao trocar senha.';
    // Better-auth APIError tem statusCode em alguns casos; ignoramos e devolvemos 400
    return c.json({ error: msg || 'Senha atual incorreta.' }, 400);
  }
});
