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
import { parseYoutubeUrl } from '../lib/youtube-url';
import { createSubscriber, getRedisPublisher } from '../lib/redis';
import {
  isTerminalStage,
  jobChannel,
  notifyNewJob,
  publishJobEvent,
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
  const yt = parseYoutubeUrl(parsed.data.url);
  if (!yt) {
    return c.json({ error: 'URL não suportada — use um link do YouTube.' }, 400);
  }

  const existingTranscript = await db.transcript.findFirst({
    where: { userId, url: yt.canonical },
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
      sourceUrl: yt.canonical,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    select: { id: true },
  });
  if (inflight) {
    return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
  }

  const job = await db.job.create({
    data: {
      userId,
      type: 'DOWNLOAD_AND_TRANSCRIBE',
      status: 'QUEUED',
      sourceUrl: yt.canonical,
    },
    select: { id: true, status: true, sourceUrl: true, queuedAt: true },
  });

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
  });
  await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);

  return c.json({ jobId: job.id, status: job.status, sourceUrl: job.sourceUrl }, 201);
});

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
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await sub.quit().catch(() => undefined);
    };

    stream.onAbort(() => {
      void close();
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

    // Mantém handler aberto enquanto não fechou
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (closed) {
          clearInterval(check);
          clearInterval(heartbeat);
          resolve();
        }
      }, 250);
    });
  });
});

// Helper só pros testes — não exportado pra uso de produção via fora do módulo.
export {
  publishJobEvent as __publishJobEventForTests,
  getRedisPublisher as __getPublisherForTests,
};
