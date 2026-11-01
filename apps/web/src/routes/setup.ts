// ============================================================================
// Voxen — knowledge-base setup (Product 1, spec 215)
// ============================================================================
// No model-provider account, key, or model configuration. Fresh installs
// complete onboarding with instance preferences only.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { isValidIanaTimezone, normalizeAppTimezone } from '../lib/app-timezone';
import { db } from '../lib/db';
import {
  getAppLanguage,
  getAppTimezone,
  getSetting,
  isSetupComplete,
  setSettings,
} from '../lib/settings';

export const setupRoutes = new Hono<{ Variables: { adminUserId: string } }>();

setupRoutes.use('*', async (c, next) => {
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

setupRoutes.get('/', async (c) => {
  const [onboardingDone, language, timezone] = await Promise.all([
    getSetting('onboarding_done').catch(() => null),
    getAppLanguage(),
    getAppTimezone(),
  ]);
  return c.json({
    complete: onboardingDone === 'true',
    language,
    timezone,
  });
});

const SaveBody = z
  .object({
    // O onboarding coleta estes valores em etapas próprias. Eles continuam no
    // mesmo POST para que a primeira configuração seja atômica.
    app_language: z.enum(['pt-BR', 'en']).optional(),
    app_timezone: z.string().trim().min(1).max(64).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    ({ app_language, app_timezone }) => app_language !== undefined || app_timezone !== undefined,
  );

setupRoutes.post('/', async (c) => {
  const parsed = SaveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }

  const { app_language, app_timezone, reason } = parsed.data;
  const metadata = { actorUserId: c.get('adminUserId'), reason };
  if (app_timezone !== undefined && !isValidIanaTimezone(app_timezone)) {
    return c.json({ error: 'Timezone IANA inválido.' }, 400);
  }

  await setSettings(
    {
      ...(app_language !== undefined ? { app_language } : {}),
      ...(app_timezone !== undefined ? { app_timezone: normalizeAppTimezone(app_timezone) } : {}),
    },
    metadata,
  );
  return c.json({ complete: await isSetupComplete() });
});
