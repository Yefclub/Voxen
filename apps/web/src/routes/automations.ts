// ============================================================================
// /api/automations — jobs periódicos com continuidade (spec 008)
// ============================================================================
// Endpoints (sempre escopados por userId):
//   GET    /api/automations              → lista do user
//   POST   /api/automations              → cria (calcula nextRunAt)
//   GET    /api/automations/:id          → detalhe
//   PATCH  /api/automations/:id          → edita (recalcula nextRunAt)
//   DELETE /api/automations/:id          → deleta (cascade runs)
//   POST   /api/automations/:id/run      → trigger manual (não desloca cron)
//   GET    /api/automations/:id/runs     → lista runs
//   GET    /api/automations/runs/:runId  → detalhe de run
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { computeNextRun, type Frequency } from '../lib/automation-schedule';
import { getRedisPublisher } from '../lib/redis';

type Vars = { userId: string };

export const automationsRoutes = new Hono<{ Variables: Vars }>();

const AUTOMATION_RUN_CHANNEL = 'automations:run';

automationsRoutes.use('*', async (c, next) => {
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

const FrequencyEnum = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);
const TypeEnum = z.enum(['PERIODIC_SUMMARY', 'WEB_RESEARCH']);
const DeliveryEnum = z.enum(['IN_APP', 'TELEGRAM', 'BOTH']);
const StatusEnum = z.enum(['ACTIVE', 'PAUSED']);

// Valida que `tz` é uma zona IANA reconhecida pelo runtime. Sem isso,
// Intl.DateTimeFormat lança RangeError em `computeNextRun`, propagando como
// 500 com stack vazada. Cliente malicioso pode mandar "Foo/Bar" via devtools.
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  type: TypeEnum,
  prompt: z.string().min(1).max(4000),
  frequency: FrequencyEnum,
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  timezone: z
    .string()
    .max(64)
    .default('America/Sao_Paulo')
    .refine(isValidTimezone, { message: 'Timezone IANA inválido.' }),
  delivery: DeliveryEnum.default('IN_APP'),
});

const UpdateBody = CreateBody.partial().extend({
  status: StatusEnum.optional(),
});

// GET /api/automations — lista
automationsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const list = await db.automation.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { runs: true } },
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, finishedAt: true },
      },
    },
  });
  return c.json({
    automations: list.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      prompt: a.prompt,
      frequency: a.frequency,
      hour: a.hour,
      minute: a.minute,
      dayOfWeek: a.dayOfWeek,
      dayOfMonth: a.dayOfMonth,
      timezone: a.timezone,
      delivery: a.delivery,
      status: a.status,
      lastRunAt: a.lastRunAt,
      nextRunAt: a.nextRunAt,
      runCount: a._count.runs,
      lastRun: a.runs[0] ?? null,
      createdAt: a.createdAt,
    })),
  });
});

// POST /api/automations — cria
automationsRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Payload inválido.', details: parsed.error.issues }, 400);
  const data = parsed.data;
  // Validações cruzadas
  if (data.frequency === 'WEEKLY' && data.dayOfWeek == null) {
    return c.json({ error: 'Frequência WEEKLY exige dayOfWeek.' }, 400);
  }
  if (data.frequency === 'MONTHLY' && data.dayOfMonth == null) {
    return c.json({ error: 'Frequência MONTHLY exige dayOfMonth.' }, 400);
  }
  // Se delivery exige Telegram mas user não linkou, rejeita
  if (data.delivery !== 'IN_APP') {
    const link = await db.telegramLink.findUnique({ where: { userId }, select: { id: true } });
    if (!link) {
      return c.json({ error: 'Telegram não vinculado em /conta.' }, 400);
    }
  }
  const nextRunAt = computeNextRun(
    {
      frequency: data.frequency as Frequency,
      hour: data.hour,
      minute: data.minute,
      dayOfWeek: data.dayOfWeek ?? null,
      dayOfMonth: data.dayOfMonth ?? null,
      timezone: data.timezone,
    },
    new Date(),
  );
  const a = await db.automation.create({
    data: {
      userId,
      name: data.name,
      type: data.type,
      prompt: data.prompt,
      frequency: data.frequency,
      hour: data.hour,
      minute: data.minute,
      dayOfWeek: data.dayOfWeek ?? null,
      dayOfMonth: data.dayOfMonth ?? null,
      timezone: data.timezone,
      delivery: data.delivery,
      nextRunAt,
    },
  });
  return c.json({ automation: a }, 201);
});

// GET /api/automations/:id — detalhe
automationsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const a = await db.automation.findFirst({ where: { id, userId } });
  if (!a) return c.json({ error: 'Automação não encontrada.' }, 404);
  return c.json({ automation: a });
});

// PATCH /api/automations/:id — edita
automationsRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = UpdateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Payload inválido.', details: parsed.error.issues }, 400);
  const a = await db.automation.findFirst({ where: { id, userId } });
  if (!a) return c.json({ error: 'Automação não encontrada.' }, 404);

  const merged = { ...a, ...parsed.data };
  if (merged.frequency === 'WEEKLY' && merged.dayOfWeek == null) {
    return c.json({ error: 'Frequência WEEKLY exige dayOfWeek.' }, 400);
  }
  if (merged.frequency === 'MONTHLY' && merged.dayOfMonth == null) {
    return c.json({ error: 'Frequência MONTHLY exige dayOfMonth.' }, 400);
  }
  // Recalcula nextRunAt se mudou algo de cronograma OU status virou ACTIVE
  const scheduleChanged =
    parsed.data.frequency !== undefined ||
    parsed.data.hour !== undefined ||
    parsed.data.minute !== undefined ||
    parsed.data.dayOfWeek !== undefined ||
    parsed.data.dayOfMonth !== undefined ||
    parsed.data.timezone !== undefined ||
    (parsed.data.status === 'ACTIVE' && a.status === 'PAUSED');

  let nextRunAt = a.nextRunAt;
  if (scheduleChanged) {
    nextRunAt = computeNextRun(
      {
        frequency: merged.frequency as Frequency,
        hour: merged.hour,
        minute: merged.minute,
        dayOfWeek: merged.dayOfWeek ?? null,
        dayOfMonth: merged.dayOfMonth ?? null,
        timezone: merged.timezone,
      },
      new Date(),
    );
  }
  // Se pausou, zera nextRunAt — scheduler não pega
  if (parsed.data.status === 'PAUSED') {
    nextRunAt = null;
  }
  const updated = await db.automation.update({
    where: { id },
    data: { ...parsed.data, nextRunAt },
  });
  return c.json({ automation: updated });
});

// DELETE /api/automations/:id
automationsRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const result = await db.automation.deleteMany({ where: { id, userId } });
  if (result.count === 0) return c.json({ error: 'Automação não encontrada.' }, 404);
  return c.json({ ok: true });
});

// POST /api/automations/:id/run — trigger manual
automationsRoutes.post('/:id/run', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const a = await db.automation.findFirst({ where: { id, userId } });
  if (!a) return c.json({ error: 'Automação não encontrada.' }, 404);
  const run = await db.automationRun.create({
    data: {
      automationId: id,
      userId,
      status: 'PENDING',
      triggeredBy: 'manual',
    },
    select: { id: true, status: true, createdAt: true },
  });
  // Notifica worker via Redis (best-effort; reconciliation pega se falhar)
  try {
    const redis = getRedisPublisher();
    await redis.publish(AUTOMATION_RUN_CHANNEL, run.id);
  } catch (err) {
    console.error('[automations] redis publish failed:', err instanceof Error ? err.message : err);
  }
  return c.json({ runId: run.id, status: run.status, createdAt: run.createdAt }, 202);
});

// GET /api/automations/:id/runs
automationsRoutes.get('/:id/runs', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20), 1), 100);
  const a = await db.automation.findFirst({ where: { id, userId }, select: { id: true } });
  if (!a) return c.json({ error: 'Automação não encontrada.' }, 404);
  const runs = await db.automationRun.findMany({
    where: { automationId: id, userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      outputMd: true,
      errorMessage: true,
      tokensIn: true,
      tokensOut: true,
      costUsd: true,
      noteId: true,
      telegramSent: true,
      triggeredBy: true,
      createdAt: true,
    },
  });
  return c.json({
    runs: runs.map((r) => ({ ...r, costUsd: r.costUsd.toString() })),
  });
});

// GET /api/automations/runs/:runId — detalhe (rota separada pra navegação direta)
automationsRoutes.get('/runs/:runId', async (c) => {
  const userId = c.get('userId');
  const runId = c.req.param('runId');
  const run = await db.automationRun.findFirst({
    where: { id: runId, userId },
    include: {
      automation: { select: { id: true, name: true, type: true } },
    },
  });
  if (!run) return c.json({ error: 'Run não encontrada.' }, 404);
  return c.json({
    run: {
      ...run,
      costUsd: run.costUsd.toString(),
    },
  });
});
