// ============================================================================
// /api/captures — link and file capture (spec 220)
// ============================================================================
// POST   /api/captures                 { url }  → submit checks, then job
// POST   /api/captures/upload          multipart file → job
// GET    /api/captures                 recent captures (cursor = job id)
// GET    /api/captures/:id             one capture
// GET    /api/captures/:id/events      SSE progress with Last-Event-ID replay
// POST   /api/captures/:id/cancel
// POST   /api/captures/:id/retry       failed/cancelled → same row, attempt 0
// POST   /api/captures/reprocess/:transcriptId
// userId always comes from the session; nothing here fetches the URL.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';

import { Prisma } from '../../prisma-generated/client';
import { auth } from '../lib/auth';
import {
  describeCaptureError,
  isCaptureErrorCode,
  type CaptureErrorCode,
  type CaptureLocale,
} from '../lib/capture/errors';
import {
  ACTIVE_STATUSES,
  CAPTURE_TYPES,
  enqueueCapture,
  submitCaptureUpload,
  submitCaptureUrl,
  textRoleConfigured,
  type SubmitOutcome,
} from '../lib/capture/submit';
import { isCaptureUrlError, parseCaptureUrl } from '../lib/capture/url';
import { db } from '../lib/db';
import {
  isTerminalStage,
  jobChannel,
  notifyNewJob,
  publishJobEvent,
  requestCancel,
  type JobStage,
} from '../lib/job-events';
import { rateLimit } from '../lib/rate-limit';
import { createSubscriber } from '../lib/redis';
import { getAppLanguage } from '../lib/settings';

export { submitCaptureUpload, submitCaptureUrl, type SubmitOutcome } from '../lib/capture/submit';

type Vars = { userId: string };

export const captureRoutes = new Hono<{ Variables: Vars }>();

const ACTIVE = ACTIVE_STATUSES;

captureRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') return c.json({ error: 'Acesso negado.' }, 403);
  c.set('userId', session.user.id);
  return next();
});

const JOB_SELECT = {
  id: true,
  type: true,
  status: true,
  sourceUrl: true,
  transcriptId: true,
  refreshTranscriptId: true,
  progressStage: true,
  progressPercent: true,
  captureErrorCode: true,
  captureCostUsd: true,
  captureMeta: true,
  errorMsg: true,
  attempt: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  notBefore: true,
  transcript: { select: { id: true, title: true, transcriptionMethod: true, model: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

async function locale(): Promise<CaptureLocale> {
  return (await getAppLanguage()) === 'en' ? 'en' : 'pt-BR';
}

function serializeJob(job: JobRow, lang: CaptureLocale) {
  const meta = (job.captureMeta ?? {}) as Record<string, unknown>;
  const upload = meta.upload as { filename?: string } | undefined;
  return {
    id: job.id,
    kind: job.type === 'CAPTURE_UPLOAD' ? 'upload' : 'link',
    status: job.status,
    sourceUrl: job.type === 'CAPTURE_UPLOAD' ? null : job.sourceUrl,
    filename: upload?.filename ?? null,
    platform: typeof meta.platform === 'string' ? meta.platform : null,
    stage: job.progressStage,
    percent: job.progressPercent,
    attempt: job.attempt,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    retryAt: job.status === 'QUEUED' ? job.notBefore : null,
    costUsd: job.captureCostUsd === null ? null : Number(job.captureCostUsd),
    reprocessOf: job.refreshTranscriptId,
    transcript: job.transcript
      ? {
          id: job.transcript.id,
          title: job.transcript.title,
          method: job.transcript.transcriptionMethod,
          model: job.transcript.model,
        }
      : job.refreshTranscriptId &&
          (job.status === 'DONE' || job.status === 'COMPLETED_WITH_WARNINGS')
        ? { id: job.refreshTranscriptId, title: null, method: null, model: null }
        : null,
    error:
      job.captureErrorCode && isCaptureErrorCode(job.captureErrorCode)
        ? describeCaptureError(job.captureErrorCode, lang)
        : null,
  };
}

function errorBody(
  code: CaptureErrorCode,
  lang: CaptureLocale,
  extra: Record<string, unknown> = {},
) {
  return { error: { ...describeCaptureError(code, lang), ...extra } };
}

async function readJob(userId: string, id: string): Promise<JobRow | null> {
  return db.job.findFirst({
    where: { id, userId, type: { in: [...CAPTURE_TYPES] } },
    select: JOB_SELECT,
  });
}

async function respondOutcome(
  c: { json: (body: unknown, status?: number) => Response },
  userId: string,
  outcome: SubmitOutcome,
) {
  const lang = await locale();
  if (outcome.kind === 'error') {
    const extra = outcome.code === 'AI_NOT_CONFIGURED' ? { settingsUrl: '/conta/ia' } : {};
    return c.json(errorBody(outcome.code, lang, extra), outcome.status);
  }
  if (outcome.kind === 'existing') {
    return c.json(
      { existing: true, transcript: { id: outcome.transcriptId, title: outcome.title } },
      200,
    );
  }
  const job = await readJob(userId, outcome.jobId);
  return c.json(
    { job: job ? serializeJob(job, lang) : { id: outcome.jobId }, deduped: outcome.deduped },
    outcome.deduped ? 200 : 202,
  );
}

async function submitRateLimited(userId: string): Promise<boolean> {
  const limit = await rateLimit(`capture-submit:${userId}`, 30, 60).catch(() => ({
    allowed: true,
  }));
  return !limit.allowed;
}

const SubmitBody = z.object({ url: z.string().max(4096) });

captureRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  if (await submitRateLimited(userId))
    return c.json({ error: 'Muitas capturas em sequência. Aguarde um minuto.' }, 429);
  const body = SubmitBody.safeParse(await c.req.json().catch(() => null));
  const lang = await locale();
  if (!body.success) return c.json(errorBody('INVALID_URL', lang), 400);
  return respondOutcome(c, userId, await submitCaptureUrl(userId, body.data.url));
});

captureRoutes.post('/upload', async (c) => {
  const userId = c.get('userId');
  if (await submitRateLimited(userId))
    return c.json({ error: 'Muitas capturas em sequência. Aguarde um minuto.' }, 429);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return c.json(errorBody('UNSUPPORTED', await locale()), 415);
  return respondOutcome(c, userId, await submitCaptureUpload(userId, file));
});

captureRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const cursor = c.req.query('cursor');
  const rows = await db.job.findMany({
    where: { userId, type: { in: [...CAPTURE_TYPES] } },
    select: JOB_SELECT,
    orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const lang = await locale();
  const page = rows.slice(0, limit);
  return c.json({
    captures: page.map((row) => serializeJob(row, lang)),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  });
});

captureRoutes.get('/:id', async (c) => {
  const job = await readJob(c.get('userId'), c.req.param('id'));
  if (!job) return c.json({ error: 'Captura não encontrada.' }, 404);
  return c.json({ capture: serializeJob(job, await locale()) });
});

captureRoutes.post('/:id/cancel', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const now = new Date();
  const updated = await db.job.updateMany({
    where: { id, userId, type: { in: [...CAPTURE_TYPES] }, status: { in: [...ACTIVE] } },
    data: {
      status: 'CANCELLED',
      captureErrorCode: 'CANCELLED',
      errorMsg: describeCaptureError('CANCELLED', await locale()).message,
      finishedAt: now,
      workerId: null,
      leaseExpiresAt: null,
      progressStage: 'cancelled',
      progressedAt: now,
    },
  });
  if (updated.count === 0) {
    const exists = await readJob(userId, id);
    return exists
      ? c.json({ error: 'A captura já terminou.' }, 409)
      : c.json({ error: 'Captura não encontrada.' }, 404);
  }
  await publishJobEvent(userId, { jobId: id, stage: 'cancelled' }).catch(() => {});
  await requestCancel(id).catch(() => {});
  const job = await readJob(userId, id);
  return c.json({ capture: job ? serializeJob(job, await locale()) : null });
});

captureRoutes.post('/:id/retry', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const current = await readJob(userId, id);
  if (!current) return c.json({ error: 'Captura não encontrada.' }, 404);
  if (current.status !== 'FAILED' && current.status !== 'CANCELLED') {
    return c.json({ error: 'Só capturas com falha ou canceladas podem ser repetidas.' }, 409);
  }
  if (!(await textRoleConfigured(userId))) {
    return c.json(
      errorBody('AI_NOT_CONFIGURED', await locale(), { settingsUrl: '/conta/ia' }),
      409,
    );
  }
  const meta = (current.captureMeta ?? {}) as Record<string, unknown>;
  if (meta.artifactPurged === true && current.type === 'CAPTURE_UPLOAD') {
    // The stored upload was removed by the retention sweep; it must be sent again.
    return c.json(errorBody('UNSUPPORTED', await locale(), { reason: 'upload_expired' }), 409);
  }
  const { artifactPurged: _purged, ...freshMeta } = meta;
  try {
    await db.job.updateMany({
      where: { id, userId, status: { in: ['FAILED', 'CANCELLED'] } },
      data: {
        status: 'QUEUED',
        captureMeta: freshMeta as Prisma.InputJsonValue,
        attempt: 0,
        notBefore: null,
        captureErrorCode: null,
        errorMsg: null,
        finishedAt: null,
        queuedAt: new Date(),
        progressStage: 'queued',
        progressPercent: 0,
        progressedAt: new Date(),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return c.json({ error: 'Já existe uma captura ativa para este link.' }, 409);
    }
    throw error;
  }
  await publishJobEvent(userId, { jobId: id, stage: 'queued', percent: 0 }).catch(() => {});
  await notifyNewJob(id).catch(() => {});
  const job = await readJob(userId, id);
  return c.json({ capture: job ? serializeJob(job, await locale()) : null }, 202);
});

captureRoutes.post('/reprocess/:transcriptId', async (c) => {
  const userId = c.get('userId');
  const transcriptId = c.req.param('transcriptId');
  const lang = await locale();
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: { not: 'TRASH' } },
    select: { id: true, url: true, source: true, sourceMetadata: true },
  });
  if (!transcript) return c.json({ error: 'Documento não encontrado.' }, 404);
  const meta = (transcript.sourceMetadata ?? {}) as Record<string, unknown>;
  const candidateUrl = typeof meta.submittedUrl === 'string' ? meta.submittedUrl : transcript.url;
  const parsed = parseCaptureUrl(candidateUrl);
  if (transcript.source === 'UPLOAD' || isCaptureUrlError(parsed)) {
    return c.json(errorBody('UNSUPPORTED', lang), 422);
  }
  const active = await db.job.findFirst({
    where: { userId, refreshTranscriptId: transcriptId, status: { in: [...ACTIVE] } },
    select: { id: true },
  });
  if (active) {
    const job = await readJob(userId, active.id);
    return c.json({ job: job ? serializeJob(job, lang) : { id: active.id }, deduped: true });
  }
  if (!(await textRoleConfigured(userId))) {
    return c.json(errorBody('AI_NOT_CONFIGURED', lang, { settingsUrl: '/conta/ia' }), 409);
  }
  const outcome = await enqueueCapture({
    userId,
    type: 'CAPTURE_LINK',
    status: 'QUEUED',
    sourceUrl: parsed.canonical,
    refreshTranscriptId: transcriptId,
    captureMeta: {
      submittedUrl: parsed.url,
      platform: parsed.platform.toLowerCase(),
      reprocess: true,
    },
  });
  const job = await readJob(userId, outcome.id);
  return c.json(
    { job: job ? serializeJob(job, lang) : { id: outcome.id }, deduped: outcome.deduped },
    outcome.deduped ? 200 : 202,
  );
});

captureRoutes.get('/:id/events', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const job = await readJob(userId, id);
  if (!job) return c.json({ error: 'Captura não encontrada.' }, 404);
  const lastEventId = c.req.header('last-event-id') ?? c.req.query('lastEventId') ?? null;

  const encoder = new TextEncoder();
  const subscriber = createSubscriber();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    await subscriber.quit().catch(() => undefined);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = (): void => {
        if (closed) return;
        closed = true;
        void cleanup();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const send = (eventId: string | null, data: unknown): void => {
        if (closed) return;
        try {
          const idLine = eventId ? `id: ${eventId}\n` : '';
          controller.enqueue(
            encoder.encode(`${idLine}event: progress\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const buffered: string[] = [];
      let replaying = true;
      subscriber.on('message', (_channel, payload) => {
        if (replaying) {
          buffered.push(payload);
          return;
        }
        handleLive(payload);
      });
      const seen = new Set<string>();
      const handleLive = (payload: string): void => {
        try {
          const event = JSON.parse(payload) as { id: string; stage: JobStage };
          if (seen.has(event.id)) return;
          seen.add(event.id);
          send(event.id, event);
          if (isTerminalStage(event.stage)) close();
        } catch {
          // ignore malformed payloads
        }
      };
      try {
        await subscriber.subscribe(jobChannel(userId, id));
        let after: Date | null = null;
        if (lastEventId) {
          const anchor = await db.jobProgressEvent.findFirst({
            where: { id: lastEventId, jobId: id, userId },
            select: { createdAt: true },
          });
          after = anchor?.createdAt ?? null;
        }
        const history = await db.jobProgressEvent.findMany({
          where: { jobId: id, userId, ...(after ? { createdAt: { gt: after } } : {}) },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 120,
        });
        for (const event of history) {
          seen.add(event.id);
          send(event.id, {
            id: event.id,
            jobId: id,
            stage: event.stage,
            percent: event.percent ?? undefined,
            transcriptId: event.transcriptId ?? undefined,
            errorMsg: event.errorMsg ?? undefined,
            ts: event.createdAt.toISOString(),
          });
        }
        replaying = false;
        for (const payload of buffered.splice(0)) handleLive(payload);
        const fresh = await readJob(userId, id);
        if (
          fresh &&
          ['DONE', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED'].includes(fresh.status)
        ) {
          send(null, { snapshot: serializeJob(fresh, await locale()) });
          close();
          return;
        }
        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            closed = true;
          }
        }, 15_000);
      } catch (error) {
        closed = true;
        await cleanup();
        controller.error(error);
      }
    },
    async cancel() {
      closed = true;
      await cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
