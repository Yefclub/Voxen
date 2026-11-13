import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { Prisma } from '../../prisma-generated/client';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import { getUserSetting, setUserSetting } from '../lib/settings';
import { resolveRoleChain } from '../lib/ai/client';
import {
  AssistantError,
  getConversation,
  rewindConversation,
  sendAssistantMessage,
  stopAssistantRun,
} from '../lib/assistant/store';
import {
  AssistantPreferencesSchema,
  getAssistantPreferences,
  saveAssistantPreferences,
} from '../lib/assistant/preferences';
import { decideAddition } from '../lib/assistant/additions';

export const assistantRoutes = new Hono<{ Variables: { userId: string } }>();
assistantRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'UNAUTHENTICATED' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (user?.status !== 'APPROVED') return c.json({ error: 'FORBIDDEN' }, 403);
  // JSON mutations plus an origin check protect cookie-authenticated additions.
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    const expected = new URL(process.env.APP_BASE_URL ?? c.req.url).origin;
    if (origin && origin !== expected) return c.json({ error: 'INVALID_ORIGIN' }, 403);
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ error: 'JSON_REQUIRED' }, 415);
    const limited = await rateLimit(`assistant:${session.user.id}`, 60, 60);
    if (!limited.allowed) return c.json({ error: 'RATE_LIMITED' }, 429);
  }
  c.set('userId', session.user.id);
  return next();
});

assistantRoutes.onError((error, c) => {
  if (error instanceof AssistantError)
    return c.json(
      { error: error.code },
      error.code === 'NOT_FOUND' ? 404 : error.code === 'INPUT_TOO_LARGE' ? 413 : 409,
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return c.json({ error: 'INVALID_INPUT' }, 400);
  console.error(
    '[assistant] request failed',
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : error instanceof Error
        ? error.name
        : 'unknown',
  );
  return c.json({ error: 'ASSISTANT_UNAVAILABLE' }, 503);
});

assistantRoutes.get('/', async (c) => {
  const before = z.coerce.number().int().positive().optional().parse(c.req.query('before'));
  return c.json(await getConversation(c.get('userId'), before));
});

const SendSchema = z
  .object({
    text: z.string().trim().min(1).max(16_000),
    requestKey: z.string().uuid(),
    revision: z.number().int().min(0),
  })
  .strict();
assistantRoutes.post('/messages', async (c) => {
  const input = SendSchema.parse(await boundedJson(c.req.raw));
  const preferences = await getAssistantPreferences(c.get('userId'));
  try {
    await resolveRoleChain(c.get('userId'), preferences.role);
  } catch {
    return c.json({ error: 'AI_NOT_CONFIGURED' }, 409);
  }
  const run = await sendAssistantMessage(c.get('userId'), input);
  return c.json({ id: run.id, revision: run.revision }, 202);
});

assistantRoutes.post('/rewind', async (c) => {
  const input = z
    .object({
      messageId: z.string().min(1).max(128),
      revision: z.number().int().min(0),
      text: z.string().trim().min(1).max(16_000).optional(),
      requestKey: z.string().uuid().optional(),
    })
    .strict()
    .parse(await boundedJson(c.req.raw));
  return c.json(await rewindConversation(c.get('userId'), input));
});
assistantRoutes.post('/runs/:id/stop', async (c) => {
  await boundedJson(c.req.raw);
  await stopAssistantRun(c.get('userId'), c.req.param('id'));
  return c.json({ ok: true });
});

assistantRoutes.post('/proposals/:id/decision', async (c) => {
  const input = z
    .object({ revision: z.number().int().min(0), confirm: z.boolean() })
    .strict()
    .parse(await boundedJson(c.req.raw));
  return c.json(
    await decideAddition(c.get('userId'), c.req.param('id'), input.revision, input.confirm),
  );
});

assistantRoutes.get('/preferences', async (c) => {
  const userId = c.get('userId');
  const key = await getUserSetting(userId, 'assistant_search_key');
  return c.json({
    ...(await getAssistantPreferences(userId)),
    searchConfigured: Boolean(key),
    searchLast4: key?.slice(-4) ?? null,
  });
});
assistantRoutes.put('/preferences', async (c) => {
  const input = AssistantPreferencesSchema.extend({
    searchKey: z.string().trim().min(8).max(512).nullable().optional(),
  })
    .strict()
    .parse(await boundedJson(c.req.raw));
  if (input.searchKey !== undefined)
    await setUserSetting(c.get('userId'), 'assistant_search_key', input.searchKey ?? '');
  const preferences = await saveAssistantPreferences(
    c.get('userId'),
    AssistantPreferencesSchema.parse(input),
  );
  return c.json(preferences);
});

assistantRoutes.get('/events', async (c) => {
  const userId = c.get('userId');
  const revision = z.coerce
    .number()
    .int()
    .min(0)
    .parse(c.req.query('revision') ?? '0');
  let cursor = z.coerce
    .number()
    .int()
    .min(0)
    .parse(c.req.header('Last-Event-ID') ?? c.req.query('after') ?? '0');
  c.header('Cache-Control', 'no-store');
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    const until = Date.now() + 55_000;
    while (!stream.aborted && Date.now() < until) {
      const conversation = await db.assistantConversation.findUnique({
        where: { userId },
        select: { revision: true },
      });
      if ((conversation?.revision ?? 0) !== revision) {
        await stream.writeSSE({ event: 'reset', data: '{}' });
        break;
      }
      const events = await db.assistantEvent.findMany({
        where: { userId, revision, id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const event of events) {
        await stream.writeSSE({
          id: String(event.id),
          event: 'progress',
          data: JSON.stringify({
            kind: event.kind,
            runId: event.runId,
            revision,
            data: event.data,
          }),
        });
        cursor = event.id;
      }
      await stream.writeSSE({ event: 'heartbeat', data: '{}' });
      await stream.sleep(1000);
    }
  });
});

async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 80_000) {
      await reader.cancel();
      throw new AssistantError('INPUT_TOO_LARGE');
    }
    parts.push(next.value);
  }
  return JSON.parse(Buffer.concat(parts).toString());
}
