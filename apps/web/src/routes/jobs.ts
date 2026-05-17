// ============================================================================
// Voxen — Jobs routes
// ============================================================================
// Endpoints (spec 002):
//   POST /api/jobs              — cria job + enfileira + 201
//   GET  /api/jobs              — lista jobs do user (recente primeiro)
//   GET  /api/jobs/:id          — status + último progresso
//   GET  /api/jobs/:id/events   — SSE com eventos do canal Redis
//
// Guards: session + status=APPROVED. Setup incompleto → 412.
// Outro user pedindo job alheio → 404 (não 403 — não vaza existência).
// ============================================================================

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { isSetupComplete } from '../lib/settings';
import { parseVideoUrl } from '../lib/video-url';
import { createSubscriber } from '../lib/redis';
import {
  isTerminalStage,
  jobChannel,
  notifyNewJob,
  publishJobEvent,
  requestCancel,
  userChannel,
  type JobEvent,
} from '../lib/job-events';

type JobsVariables = {
  userId: string;
};

export const jobsRoutes = new Hono<{ Variables: JobsVariables }>();

// Guard: session + status=APPROVED
jobsRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Não autenticado.' }, 401);
  }
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

const PostBody = z.object({
  url: z.string().min(1).max(2048),
});

jobsRoutes.post('/', async (c) => {
  const userId = c.get('userId');

  if (!(await isSetupComplete())) {
    return c.json(
      { error: 'Setup incompleto. Aguarde o administrador concluir a configuração.' },
      412,
    );
  }

  const parsed = PostBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }
  const video = parseVideoUrl(parsed.data.url);
  if (!video) {
    return c.json({ error: 'URL não suportada — use link do YouTube, Instagram ou TikTok.' }, 400);
  }

  const existingTranscript = await db.transcript.findFirst({
    where: { userId, url: video.canonical },
    select: { id: true },
  });
  if (existingTranscript) {
    return c.json(
      {
        error: 'Você já transcreveu esta URL.',
        transcriptId: existingTranscript.id,
      },
      409,
    );
  }

  const inflight = await db.job.findFirst({
    where: {
      userId,
      sourceUrl: video.canonical,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    select: { id: true },
  });
  if (inflight) {
    return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
  }

  let job: { id: string; status: string; sourceUrl: string };
  try {
    job = await db.job.create({
      data: {
        userId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'QUEUED',
        sourceUrl: video.canonical,
      },
      select: { id: true, status: true, sourceUrl: true },
    });
  } catch (err) {
    // Partial unique index `Job_user_url_active_unique` cobre a race entre
    // 2 POSTs simultâneos da mesma URL: o primeiro cria, o segundo cai aqui.
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
    }
    throw err;
  }

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
  });
  await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);

  return c.json({ jobId: job.id, status: job.status, sourceUrl: job.sourceUrl }, 201);
});

// POST /api/jobs/scrape — agenda scraping de página web (spec 004)
jobsRoutes.post('/scrape', async (c) => {
  const userId = c.get('userId');

  if (!(await isSetupComplete())) {
    return c.json(
      { error: 'Setup incompleto. Aguarde o administrador concluir a configuração.' },
      412,
    );
  }

  const body = (await c.req.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();
  if (!rawUrl) {
    return c.json({ error: 'URL ausente.' }, 400);
  }
  const normalized = normalizeWebUrl(rawUrl);
  if (!normalized) {
    return c.json({ error: 'URL inválida — informe um link http(s) válido.' }, 400);
  }

  const existingTranscript = await db.transcript.findFirst({
    where: { userId, url: normalized },
    select: { id: true },
  });
  if (existingTranscript) {
    return c.json(
      { error: 'Você já indexou esta página.', transcriptId: existingTranscript.id },
      409,
    );
  }

  const inflight = await db.job.findFirst({
    where: { userId, sourceUrl: normalized, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true },
  });
  if (inflight) {
    return c.json({ error: 'Esta URL já está sendo processada.', jobId: inflight.id }, 409);
  }

  let job: { id: string; status: string; sourceUrl: string };
  try {
    job = await db.job.create({
      data: {
        userId,
        type: 'SCRAPE_WEB',
        status: 'QUEUED',
        sourceUrl: normalized,
      },
      select: { id: true, status: true, sourceUrl: true },
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
    }
    throw err;
  }

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
  });
  await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);

  return c.json({ jobId: job.id, status: job.status, sourceUrl: job.sourceUrl }, 201);
});

function normalizeWebUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    // Remove fragments (#anchor) — não afetam o conteúdo extraído.
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

jobsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const jobs = await db.job.findMany({
    where: { userId },
    orderBy: { queuedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      sourceUrl: true,
      errorMsg: true,
      transcriptId: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  return c.json({ jobs });
});

jobsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const job = await db.job.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      sourceUrl: true,
      errorMsg: true,
      transcriptId: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!job) {
    // 404 (não 403) — evita vazar existência cross-workspace
    return c.json({ error: 'Job não encontrado.' }, 404);
  }
  return c.json({ job });
});

jobsRoutes.post('/:id/retry', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const original = await db.job.findFirst({
    where: { id, userId },
    select: { id: true, status: true, sourceUrl: true },
  });
  if (!original) {
    return c.json({ error: 'Job não encontrado.' }, 404);
  }
  if (original.status !== 'FAILED' && original.status !== 'CANCELLED') {
    return c.json({ error: 'Só é possível retentar jobs que falharam ou foram cancelados.' }, 400);
  }

  // Se já existe Transcript com esta URL pro user, não vale retentar
  const existingTranscript = await db.transcript.findFirst({
    where: { userId, url: original.sourceUrl },
    select: { id: true },
  });
  if (existingTranscript) {
    return c.json(
      {
        error: 'Você já transcreveu esta URL.',
        transcriptId: existingTranscript.id,
      },
      409,
    );
  }

  // Cria novo job (partial unique index permite porque o original é FAILED)
  let newJob: { id: string; status: string; sourceUrl: string };
  try {
    newJob = await db.job.create({
      data: {
        userId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'QUEUED',
        sourceUrl: original.sourceUrl,
      },
      select: { id: true, status: true, sourceUrl: true },
    });
  } catch (err) {
    // Race: outro retry já criou um job ativo. Devolve o que existe.
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      const active = await db.job.findFirst({
        where: {
          userId,
          sourceUrl: original.sourceUrl,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        select: { id: true, status: true, sourceUrl: true },
      });
      if (active) {
        return c.json(
          { jobId: active.id, status: active.status, sourceUrl: active.sourceUrl },
          200,
        );
      }
      return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
    }
    throw err;
  }

  await notifyNewJob(newJob.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
  });
  await publishJobEvent(userId, { jobId: newJob.id, stage: 'queued' }).catch(() => undefined);

  return c.json({ jobId: newJob.id, status: newJob.status, sourceUrl: newJob.sourceUrl }, 201);
});

// POST /api/jobs/:id/cancel — sinaliza cancelamento.
// QUEUED → vira CANCELLED imediatamente no DB.
// RUNNING → publica no canal jobs:cancel; worker checa periodicamente
//   e interrompe. Em ambos os casos, marca no DB pra evitar reconciliação.
jobsRoutes.post('/:id/cancel', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const job = await db.job.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
  if (!job) {
    return c.json({ error: 'Job não encontrado.' }, 404);
  }
  if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
    return c.json({ error: 'Só é possível cancelar jobs ativos.' }, 400);
  }
  await db.job.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      errorMsg: 'Cancelado pelo usuário.',
      finishedAt: new Date(),
    },
  });
  await requestCancel(id).catch(() => undefined);
  await publishJobEvent(userId, {
    jobId: id,
    stage: 'cancelled',
    errorMsg: 'Cancelado pelo usuário.',
  }).catch(() => undefined);
  return c.json({ ok: true });
});

// SSE global por user — toast notification em qualquer página.
jobsRoutes.get('/events/me', async (c) => {
  const userId = c.get('userId');
  return streamSSE(c, async (stream) => {
    const sub = createSubscriber();
    let closed = false;
    let resolveClose!: () => void;
    const done = new Promise<void>((r) => {
      resolveClose = r;
    });
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await sub.quit().catch(() => undefined);
      resolveClose();
    };
    stream.onAbort(() => {
      void close();
    });

    await stream.writeSSE({ event: 'connected', data: '{}' });
    await sub.subscribe(userChannel(userId));
    sub.on('message', (_chan, raw) => {
      if (closed) return;
      void stream.writeSSE({ event: 'progress', data: raw });
    });

    // Heartbeat 30s
    const hb = setInterval(() => {
      if (closed) {
        clearInterval(hb);
        return;
      }
      void stream.writeSSE({ event: 'ping', data: String(Date.now()) });
    }, 30_000);

    try {
      await done;
    } finally {
      clearInterval(hb);
    }
  });
});

jobsRoutes.get('/:id/events', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const job = await db.job.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
  if (!job) {
    return c.json({ error: 'Job não encontrado.' }, 404);
  }

  return streamSSE(c, async (stream) => {
    const sub = createSubscriber();
    let closed = false;
    let resolveClose!: () => void;
    const done = new Promise<void>((r) => {
      resolveClose = r;
    });
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await sub.quit().catch(() => undefined);
      resolveClose();
    };

    stream.onAbort(() => {
      void close();
    });

    // Evento inicial pra confirmar conexão (facilita debug e UI)
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ jobId: job.id }),
    });

    // Job já em estado terminal: manda 1 evento e fecha
    if (job.status === 'DONE' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      await stream.writeSSE({
        event: 'snapshot',
        data: JSON.stringify({ jobId: job.id, stage: job.status.toLowerCase() }),
      });
      await close();
      return;
    }

    await sub.subscribe(jobChannel(userId, id));
    sub.on('message', (_chan, raw) => {
      if (closed) return;
      let evt: JobEvent;
      try {
        evt = JSON.parse(raw) as JobEvent;
      } catch {
        return;
      }
      void stream.writeSSE({ event: 'progress', data: raw });
      if (isTerminalStage(evt.stage)) {
        void close();
      }
    });

    // Heartbeat a cada 15s pra manter conexão viva atrás de proxies
    const heartbeat = setInterval(() => {
      if (closed) {
        clearInterval(heartbeat);
        return;
      }
      void stream.writeSSE({ event: 'ping', data: String(Date.now()) });
    }, 15_000);

    try {
      await done;
    } finally {
      clearInterval(heartbeat);
    }
  });
});
