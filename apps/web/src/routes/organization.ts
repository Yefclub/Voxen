import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { AiError } from '../lib/ai/errors';
import { resolveRoleChain } from '../lib/ai/client';
import { rateLimit } from '../lib/rate-limit';
import { structuredDiagnostic } from '../lib/structured-log';
import {
  getOrganizationPreferences,
  OrganizationModeSchema,
  saveOrganizationPreferences,
} from '../lib/organization/preferences';
import { enqueueOrganization } from '../lib/organization/queue';
import { OrganizationError } from '../lib/organization/source';
import {
  cancelOrganization,
  listOrganization,
  readOrganization,
  OrganizationCancelSchema,
} from '../lib/organization/views';

export const organizationRoutes = new Hono<{ Variables: { userId: string } }>();
organizationRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'UNAUTHENTICATED' }, 401);
  const owner = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (owner?.status !== 'APPROVED') return c.json({ error: 'FORBIDDEN' }, 403);
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(process.env.APP_BASE_URL ?? c.req.url).origin)
      return c.json({ error: 'INVALID_ORIGIN' }, 403);
    if (c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
      return c.json({ error: 'JSON_REQUIRED' }, 415);
    if (!(await rateLimit(`organization:${session.user.id}`, 60, 60)).allowed)
      return c.json({ error: 'RATE_LIMITED' }, 429);
  }
  c.set('userId', session.user.id);
  return next();
});
organizationRoutes.onError((error, c) => {
  if (error instanceof OrganizationError)
    return c.json(
      { error: error.code },
      error.code === 'NOT_FOUND' ? 404 : error.code === 'INPUT_TOO_LARGE' ? 413 : 409,
    );
  if (error instanceof AiError && error.code === 'AI_NOT_CONFIGURED')
    return c.json({ error: error.code }, 409);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return c.json({ error: 'INVALID_INPUT' }, 400);
  structuredDiagnostic(
    'warning',
    'organization-request-failed',
    'ORGANIZATION_REQUEST_FAILED',
    error,
  );
  return c.json({ error: 'ORGANIZATION_UNAVAILABLE' }, 503);
});
organizationRoutes.get('/preferences', async (c) =>
  c.json(await getOrganizationPreferences(c.get('userId'))),
);
organizationRoutes.put('/preferences', async (c) => {
  const { mode } = z
    .object({ mode: OrganizationModeSchema })
    .strict()
    .parse(await json(c.req.raw));
  const userId = c.get('userId');
  if (mode !== 'OFF') await resolveRoleChain(userId, 'standard');
  return c.json(await saveOrganizationPreferences(userId, mode));
});
const Id = z.string().min(1).max(128);
organizationRoutes.get('/documents/:transcriptId', async (c) =>
  c.json(
    await listOrganization(
      c.get('userId'),
      Id.parse(c.req.param('transcriptId')),
      Id.optional().parse(c.req.query('cursor')),
    ),
  ),
);
organizationRoutes.post('/documents/:transcriptId', async (c) => {
  const { requestKey } = z
    .object({ requestKey: z.string().uuid() })
    .strict()
    .parse(await json(c.req.raw));
  const userId = c.get('userId'),
    transcriptId = Id.parse(c.req.param('transcriptId'));
  if (
    !(await db.transcript.findFirst({
      where: { id: transcriptId, userId, status: 'ACTIVE' },
      select: { id: true },
    }))
  )
    throw new OrganizationError('NOT_FOUND');
  if ((await getOrganizationPreferences(userId)).mode === 'OFF')
    throw new OrganizationError('DISABLED');
  await resolveRoleChain(userId, 'standard');
  const row = await enqueueOrganization(userId, transcriptId, 'MANUAL', requestKey);
  return c.json({ id: row!.id }, 202);
});
organizationRoutes.get('/documents/:transcriptId/:id', async (c) =>
  c.json(
    await readOrganization(
      c.get('userId'),
      Id.parse(c.req.param('transcriptId')),
      Id.parse(c.req.param('id')),
    ),
  ),
);
organizationRoutes.patch('/documents/:transcriptId/:id', async (c) =>
  c.json(
    await cancelOrganization(
      c.get('userId'),
      Id.parse(c.req.param('transcriptId')),
      Id.parse(c.req.param('id')),
      OrganizationCancelSchema.parse(await json(c.req.raw)),
    ),
  ),
);
async function json(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1000) {
      await reader.cancel();
      throw new OrganizationError('INPUT_TOO_LARGE');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
