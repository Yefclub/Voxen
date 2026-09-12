import type { Hono } from 'hono';
import { z } from 'zod';
import { getPersonalInterestProjections } from '../lib/personal-interest-projections';
import {
  clearSessionIntent,
  readSessionIntent,
  recordSessionIntent,
  SESSION_INTENT_MAX_ITEMS,
  SESSION_INTENT_TTL_SEC,
} from '../lib/personal-interest-session';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';

type Vars = { userId: string };

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const SafeIntentTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 && codePoint !== 127;
      }),
    { message: 'Control characters are not allowed.' },
  );
const SessionIntentBodySchema = z.object({
  sessionId: SessionIdSchema,
  items: z
    .array(
      z.object({
        dimension: z.enum(['TOPIC', 'ENTITY', 'TAG', 'FOLDER', 'AUTHOR', 'CHANNEL', 'SOURCE']),
        key: SafeIntentTextSchema,
        label: SafeIntentTextSchema,
        weight: z.number().min(-1).max(1),
        brainNodeId: z.string().trim().min(1).max(64).nullable().default(null),
      }),
    )
    .min(1)
    .max(SESSION_INTENT_MAX_ITEMS),
});

export function registerAccountInterestRoutes(
  routes: Hono<{ Variables: Vars }>,
  dependencies: { readIntent?: typeof readSessionIntent } = {},
): void {
  const readIntent = dependencies.readIntent ?? readSessionIntent;
  routes.get('/interests', async (c) => {
    const userId = c.get('userId');
    const force = c.req.query('refresh') === 'true';
    if (force) {
      const rl = await rateLimit(`voxen:rl:interest-projection:${userId}`, 4, 60);
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.resetIn));
        return c.json({ error: 'Muitas atualizações. Tente novamente em instantes.' }, 429);
      }
    }
    const projections = await getPersonalInterestProjections({ userId, force });
    const rawSessionId = c.req.query('sessionId');
    if (!rawSessionId) {
      return c.json({ projections, sessionIntent: null, sessionIntentAvailable: true });
    }
    const sessionId = SessionIdSchema.safeParse(rawSessionId);
    if (!sessionId.success) return c.json({ error: 'Sessão inválida.' }, 400);
    try {
      const sessionIntent = await readIntent({ userId, sessionId: sessionId.data });
      return c.json({ projections, sessionIntent, sessionIntentAvailable: true });
    } catch {
      return c.json({ projections, sessionIntent: null, sessionIntentAvailable: false });
    }
  });

  routes.put('/interests/session', async (c) => {
    const userId = c.get('userId');
    const parsed = SessionIntentBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Intenção de sessão inválida.' }, 400);
    const rl = await rateLimit(`voxen:rl:interest-session:${userId}`, 30, 60);
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.resetIn));
      return c.json({ error: 'Muitas alterações. Tente novamente em instantes.' }, 429);
    }
    const requestedNodeIds = [
      ...new Set(
        parsed.data.items
          .map((item) => item.brainNodeId)
          .filter((nodeId): nodeId is string => nodeId !== null),
      ),
    ];
    if (requestedNodeIds.length > 0) {
      const ownedNodeCount = await db.brainNode.count({
        where: { id: { in: requestedNodeIds }, userId, status: { not: 'TRASH' } },
      });
      if (ownedNodeCount !== requestedNodeIds.length) {
        return c.json({ error: 'Nó de interesse inválido.' }, 400);
      }
    }
    const items = [
      ...new Map(
        parsed.data.items.map((item) => [`${item.dimension}:${item.key}`, item] as const),
      ).values(),
    ];
    try {
      const sessionIntent = await recordSessionIntent({
        userId,
        sessionId: parsed.data.sessionId,
        items,
      });
      return c.json({ sessionIntent, expiresInSec: SESSION_INTENT_TTL_SEC });
    } catch {
      return c.json({ error: 'Intenção temporária indisponível.' }, 503);
    }
  });

  routes.delete('/interests/session/:sessionId', async (c) => {
    const sessionId = SessionIdSchema.safeParse(c.req.param('sessionId'));
    if (!sessionId.success) return c.json({ error: 'Sessão inválida.' }, 400);
    try {
      await clearSessionIntent({ userId: c.get('userId'), sessionId: sessionId.data });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: 'Intenção temporária indisponível.' }, 503);
    }
  });
}
