// ============================================================================
// Voxen — Onboarding endpoints (admin first-run wizard)
// ============================================================================
// POST /api/onboarding         — marca onboarding como concluído + salva flags
// POST /api/onboarding/avatar  — upload de avatar do user logado (any user)
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { s3Bucket, s3Client } from '../lib/s3';
import { setSetting } from '../lib/settings';

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
  await setSetting('allow_signups', parsed.data.allow_signups ? 'true' : 'false');
  if (parsed.data.app_language !== undefined) {
    await setSetting('app_language', parsed.data.app_language);
  }
  await setSetting('onboarding_done', 'true');
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
  const bucket = s3Bucket();
  try {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: file.type,
      }),
    );
  } catch (err) {
    console.error('[onboarding] falha ao salvar avatar no S3:', err);
    return c.json(
      {
        error:
          `Falha ao salvar avatar no S3/MinIO (bucket "${bucket}"). ` +
          'Verifique endpoint, bucket e permissões de escrita.',
      },
      502,
    );
  }
  // Salva path no User.image; o endpoint /api/avatar/:userId serve o arquivo
  // via proxy (storage S3 não precisa ser público).
  const imageUrl = `/api/avatar/${userId}?v=${Date.now()}`;
  await db.user.update({ where: { id: userId }, data: { image: imageUrl } });
  return c.json({ image: imageUrl });
});
