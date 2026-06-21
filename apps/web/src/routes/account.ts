// ============================================================================
// /api/account — perfil do user logado
// ============================================================================
// GET    /api/account            — dados completos (name, email, image)
// PATCH  /api/account            — atualizar name (email é imutável aqui)
// POST   /api/account/password   — trocar senha (precisa da senha atual)
// POST   /api/account/qr-login   — gera URL de login por QR (one-time token)
// O upload de avatar reaproveita /api/onboarding/avatar (qualquer user).
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth, QR_LOGIN_TTL_SEC } from '../lib/auth';
import { db } from '../lib/db';
import { getRedisPublisher } from '../lib/redis';
import { rateLimit } from '../lib/rate-limit';

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

// ----------------------------------------------------------------------------
// Login rápido por QR (spec 060)
// ----------------------------------------------------------------------------
// Gera um one-time token (plugin better-auth) atrelado à sessão atual e devolve
// a URL `/qr-login?t=<token>` pro front renderizar como QR. O celular abre a URL
// e a página chama o verify do plugin, que seta o cookie de sessão no device.
//
// Segurança: a geração do token usa `auth.api.generateOneTimeToken`, que deriva
// a sessão dos headers (cookie) — userId NUNCA vem do cliente. Token de alta
// entropia, TTL curto, single-use, hasheado no DB. Rate-limit por usuário evita
// flood. O token NUNCA é logado.

accountRoutes.post('/qr-login', async (c) => {
  const uid = c.get('userId');

  // Rate-limit por usuário: até 5 gerações por minuto. Suficiente pra UI normal
  // (gerar + regenerar) e barra script abusivo.
  const rl = await rateLimit(`voxen:rl:qr-login:${uid}`, 5, 60);
  if (!rl.allowed) {
    return c.json(
      { error: 'Muitas tentativas. Aguarde alguns segundos.', retryInSec: rl.resetIn },
      429,
    );
  }

  // Gera o token derivando a sessão do cookie (headers da request original).
  const result = await auth.api.generateOneTimeToken({ headers: c.req.raw.headers });
  if (!result?.token) {
    return c.json({ error: 'Falha ao gerar token de login.' }, 500);
  }

  // baseURL canônica do better-auth (APP_BASE_URL) — mesma usada pra links.
  const baseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const loginUrl = `${baseUrl}/qr-login?t=${encodeURIComponent(result.token)}`;

  // NUNCA logar token nem loginUrl.
  return c.json({ loginUrl, expiresInSec: QR_LOGIN_TTL_SEC });
});

// ----------------------------------------------------------------------------
// Telegram linking
// ----------------------------------------------------------------------------
// User gera código de 6 dígitos em /conta → envia /start <code> no bot →
// worker telegram resolve e cria TelegramLink. Códigos vivem em Redis com
// TTL de 10min pra evitar replay/colisão.

accountRoutes.post('/telegram/code', async (c) => {
  const uid = c.get('userId');
  // 6 dígitos zero-padded, gerado via crypto pra evitar colisão
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const num = ((buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!) >>> 0;
  const code = String(num % 1_000_000).padStart(6, '0');
  // Grava em Redis: key tg:link:<code> = userId, expira em 600s
  const redis = getRedisPublisher();
  await redis.set(`tg:link:${code}`, uid, 'EX', 600);
  return c.json({ code, expiresInSec: 600 });
});

accountRoutes.delete('/telegram', async (c) => {
  const uid = c.get('userId');
  await db.telegramLink.deleteMany({ where: { userId: uid } });
  return c.json({ ok: true });
});

accountRoutes.get('/telegram', async (c) => {
  const uid = c.get('userId');
  const link = await db.telegramLink.findUnique({
    where: { userId: uid },
    select: { chatId: true, username: true, linkedAt: true },
  });
  if (!link) return c.json({ linked: false });
  return c.json({
    linked: true,
    username: link.username,
    chatId: link.chatId.toString(),
    linkedAt: link.linkedAt,
  });
});
