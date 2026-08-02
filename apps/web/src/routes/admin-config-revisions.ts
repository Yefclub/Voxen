import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rollbackConfigRevision } from '../lib/settings';

type Vars = { adminUserId: string };

export const adminConfigRevisionRoutes = new Hono<{ Variables: Vars }>();

adminConfigRevisionRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED' || user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

adminConfigRevisionRoutes.get('/', async (c) => {
  const beforeRaw = c.req.query('before');
  const before = beforeRaw === undefined ? undefined : Number(beforeRaw);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) {
    return c.json({ error: 'Cursor de revisão inválido.' }, 400);
  }
  const revisions = await db.configRevision.findMany({
    ...(before !== undefined ? { where: { number: { lt: before } } } : {}),
    orderBy: { number: 'desc' },
    take: 101,
    select: {
      id: true,
      number: true,
      isBaseline: true,
      reason: true,
      createdAt: true,
      actor: { select: { id: true, name: true, email: true } },
      changes: {
        orderBy: { key: 'asc' },
        select: { key: true, previousValue: true, nextValue: true, isSecret: true },
      },
    },
  });
  const page = revisions.slice(0, 100);
  return c.json({
    revisions: page.map((revision) => ({
      ...revision,
      changes: revision.changes.map((change) =>
        change.isSecret
          ? { key: change.key, isSecret: true, previousValue: null, nextValue: null }
          : change,
      ),
    })),
    nextBefore: revisions.length > 100 ? (page.at(-1)?.number ?? null) : null,
  });
});

const RollbackBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

adminConfigRevisionRoutes.post('/:number/rollback', async (c) => {
  const number = Number(c.req.param('number'));
  if (!Number.isSafeInteger(number) || number < 1)
    return c.json({ error: 'Revisão inválida.' }, 400);
  const parsed = RollbackBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  try {
    const result = await rollbackConfigRevision(number, {
      actorUserId: c.get('adminUserId'),
      reason: parsed.data.reason ?? `Rollback da revisão ${number}`,
    });
    return c.json({ revision: result.revision, skippedSecretKeys: result.skippedSecretKeys });
  } catch (error) {
    if (error instanceof Error && error.message === 'Revisão não encontrada.') {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof Error && error.message === 'A revisão-base não pode ser revertida.') {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});
