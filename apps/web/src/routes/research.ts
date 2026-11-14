import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { AiError } from '../lib/ai/errors';
import { resolveRoleChain } from '../lib/ai/client';
import { rateLimit } from '../lib/rate-limit';
import { getUserSetting } from '../lib/settings';
import { structuredDiagnostic } from '../lib/structured-log';
import {
  getResearchPreferences,
  ResearchModeSchema,
  saveResearchPreferences,
} from '../lib/research/preferences';
import { enqueueResearch, ResearchError } from '../lib/research/queue';
import { prepareResearch } from '../lib/research/context';
import {
  listResearch,
  readResearch,
  ResearchReviewSchema,
  reviewResearch,
} from '../lib/research/review';

export const researchRoutes = new Hono<{ Variables: { userId: string } }>();
researchRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'UNAUTHENTICATED' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (user?.status !== 'APPROVED') return c.json({ error: 'FORBIDDEN' }, 403);
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(process.env.APP_BASE_URL ?? c.req.url).origin)
      return c.json({ error: 'INVALID_ORIGIN' }, 403);
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ error: 'JSON_REQUIRED' }, 415);
    if (!(await rateLimit(`research:${session.user.id}`, 60, 60)).allowed)
      return c.json({ error: 'RATE_LIMITED' }, 429);
  }
  c.set('userId', session.user.id);
  return next();
});
researchRoutes.onError((error, c) => {
  if (error instanceof ResearchError)
    return c.json(
      { error: error.code },
      error.code === 'NOT_FOUND' ? 404 : error.code === 'INPUT_TOO_LARGE' ? 413 : 409,
    );
  if (error instanceof AiError && error.code === 'AI_NOT_CONFIGURED')
    return c.json({ error: error.code }, 409);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return c.json({ error: 'INVALID_INPUT' }, 400);
  structuredDiagnostic('warning', 'research-request-failed', 'RESEARCH_REQUEST_FAILED', error);
  return c.json({ error: 'RESEARCH_UNAVAILABLE' }, 503);
});

researchRoutes.get('/preferences', async (c) => {
  const userId = c.get('userId');
  const key = await getUserSetting(userId, 'assistant_search_key');
  return c.json({
    ...(await getResearchPreferences(userId)),
    searchConfigured: Boolean(key),
    searchLast4: key?.slice(-4) ?? null,
  });
});
researchRoutes.put('/preferences', async (c) => {
  const input = z
    .object({
      mode: ResearchModeSchema,
      searchKey: z.string().trim().min(8).max(512).nullable().optional(),
    })
    .strict()
    .parse(await json(c.req.raw, 4000));
  const userId = c.get('userId');
  if (input.mode !== 'OFF') {
    const key =
      input.searchKey === undefined
        ? await getUserSetting(userId, 'assistant_search_key')
        : input.searchKey;
    if (!key) throw new ResearchError('WEB_NOT_CONFIGURED');
    await resolveRoleChain(userId, 'standard');
  }
  return c.json(await saveResearchPreferences(userId, input.mode, input.searchKey));
});

const Id = z.string().min(1).max(128);
researchRoutes.get('/documents/:transcriptId', async (c) => {
  return c.json(
    await listResearch(
      c.get('userId'),
      Id.parse(c.req.param('transcriptId')),
      Id.optional().parse(c.req.query('cursor')),
    ),
  );
});
researchRoutes.post('/documents/:transcriptId', async (c) => {
  const input = z
    .object({ requestKey: z.string().uuid() })
    .strict()
    .parse(await json(c.req.raw, 1000));
  const userId = c.get('userId');
  const transcriptId = Id.parse(c.req.param('transcriptId'));
  const source = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!source) throw new ResearchError('NOT_FOUND');
  if ((await getResearchPreferences(userId)).mode === 'OFF') throw new ResearchError('DISABLED');
  await prepareResearch(userId, null);
  const row = await enqueueResearch(userId, transcriptId, 'MANUAL', input.requestKey);
  return c.json({ id: row!.id }, 202);
});
researchRoutes.get('/documents/:transcriptId/:id', async (c) => {
  return c.json(
    await readResearch(
      c.get('userId'),
      Id.parse(c.req.param('transcriptId')),
      Id.parse(c.req.param('id')),
    ),
  );
});
researchRoutes.patch('/documents/:transcriptId/:id', async (c) => {
  const input = ResearchReviewSchema.parse(await json(c.req.raw, 850_000));
  return c.json(
    await reviewResearch(
      c.get('userId'),
      Id.parse(c.req.param('transcriptId')),
      Id.parse(c.req.param('id')),
      input,
    ),
  );
});

async function json(request: Request, limit: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ResearchError('INPUT_TOO_LARGE');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
