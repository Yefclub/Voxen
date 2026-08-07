// ============================================================================
// Voxen — Onboarding endpoints (admin first-run wizard)
// ============================================================================
// POST /api/onboarding         — marca onboarding como concluído + salva flags
// POST /api/onboarding/avatar  — upload de avatar do user logado (any user)
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { resolveStorageDriver, storagePut } from '../lib/storage';
import { isValidIanaTimezone, normalizeAppTimezone } from '../lib/app-timezone';
import { setSettings } from '../lib/settings';

type Vars = { userId: string };

export const onboardingRoutes = new Hono<{ Variables: Vars }>();

onboardingRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, role: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  c.set('userId', session.user.id);
  return next();
});

const FinishBody = z.object({
  allow_signups: z.boolean(),
  app_language: z.enum(['pt-BR', 'en']).optional(),
  app_timezone: z.string().min(1).max(64).optional(),
});

onboardingRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== 'ADMIN') {
    return c.json({ error: 'Apenas o administrador pode finalizar o onboarding.' }, 403);
  }
  const parsed = FinishBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }
  if (parsed.data.app_timezone !== undefined && !isValidIanaTimezone(parsed.data.app_timezone)) {
    return c.json({ error: 'Timezone IANA inválido.' }, 400);
  }
  await setSettings(
    {
      allow_signups: parsed.data.allow_signups ? 'true' : 'false',
      ...(parsed.data.app_language !== undefined ? { app_language: parsed.data.app_language } : {}),
      ...(parsed.data.app_timezone !== undefined
        ? { app_timezone: normalizeAppTimezone(parsed.data.app_timezone) }
        : {}),
      onboarding_done: 'true',
    },
    { actorUserId: userId },
  );
  return c.json({ ok: true });
});

onboardingRoutes.post('/avatar', async (c) => {
  const userId = c.get('userId');
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('avatar');
  if (!(file instanceof File)) {
    return c.json({ error: 'Envie o arquivo no campo "avatar".' }, 400);
  }
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: 'Imagem maior que 5 MB.' }, 400);
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return c.json({ error: 'Use PNG, JPEG ou WebP.' }, 400);
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';
  const key = `workspaces/${userId}/avatar.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    await storagePut({ key, body: buf, contentType: file.type });
  } catch (err) {
    console.error('[onboarding] failed to save avatar:', err);
    return c.json(
      {
        error: `Falha ao salvar avatar no armazenamento ${resolveStorageDriver()}. Verifique a configuração e as permissões de escrita.`,
      },
      502,
    );
  }
  // Salva path no User.image; o endpoint /api/avatar/:userId serve o arquivo
  // via authenticated proxy; the selected storage never needs to be public.
  const imageUrl = `/api/avatar/${userId}?v=${Date.now()}`;
  await db.user.update({ where: { id: userId }, data: { image: imageUrl } });
  return c.json({ image: imageUrl });
});
