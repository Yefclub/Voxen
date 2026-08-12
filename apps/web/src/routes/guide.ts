import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { loadPersonalGuide } from '../lib/personal-guide-service';

type Vars = { userId: string };

export const guideRoutes = new Hono<{ Variables: Vars }>();

guideRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') return c.json({ error: 'Acesso não autorizado.' }, 403);
  c.set('userId', session.user.id);
  return next();
});

guideRoutes.get('/', async (c) => {
  const guide = await loadPersonalGuide(c.get('userId'));
  c.header('Cache-Control', 'no-store');
  return c.json(guide);
});
