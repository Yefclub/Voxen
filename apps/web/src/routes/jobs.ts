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

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { getDefaultXAnalysisModel, getSetting, isSetupComplete } from '../lib/settings';
import { parseVideoUrl } from '../lib/video-url';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_MEDIA_UPLOAD_REQUEST_BYTES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  detectUploadKind,
  putUploadFile,
  sanitizeUploadFilename,
  uploadSourceUrl,
} from '../lib/media-upload';
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

type SseMessage = {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
};

type SseConnection = {
  writeSSE(message: SseMessage): void;
  close(): Promise<void>;
  isClosed(): boolean;
  onClose(fn: () => void | Promise<void>): void;
};

const SSE_HEARTBEAT_MS = 10_000;
const SSE_RETRY_MS = 5_000;

function sseField(name: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must not contain CR/LF`);
  }
  return value;
}

function formatSseMessage(message: SseMessage): string {
  const dataLines = message.data
    .split(/\r\n|\r|\n/)
    .map((line) => `data: ${line}`)
    .join('\n');
  return (
    [
      message.event ? `event: ${sseField('event', message.event)}` : undefined,
      dataLines,
      message.id ? `id: ${sseField('id', message.id)}` : undefined,
      message.retry !== undefined ? `retry: ${message.retry}` : undefined,
    ]
      .filter(Boolean)
      .join('\n') + '\n\n'
  );
}

function sseResponse(c: Context, start: (stream: SseConnection) => Promise<void> | void): Response {
  const encoder = new TextEncoder();
  const cleanup: Array<() => void | Promise<void>> = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await Promise.all(
      cleanup.splice(0).map(async (fn) => {
        try {
          await fn();
        } catch {
          // Cleanup is best-effort; the stream is already closing.
        }
      }),
    );
    try {
      controller?.close();
    } catch {
      // Client already disconnected.
    }
  };

  const writeSSE = (message: SseMessage): void => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(formatSseMessage(message)));
    } catch {
      void close();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      const abort = () => {
        void close();
      };
      c.req.raw.signal.addEventListener('abort', abort, { once: true });
      cleanup.push(() => c.req.raw.signal.removeEventListener('abort', abort));
      void Promise.resolve(
        start({
          writeSSE,
          close,
          isClosed: () => closed,
          onClose: (fn) => cleanup.push(fn),
        }),
      ).catch(() => {
        writeSSE({ event: 'error', data: 'stream_error' });
        void close();
      });
    },
    cancel() {
      void close();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Vary: 'Cookie',
    },
  });
}

async function jobTypeForVideo(
  video: ReturnType<typeof parseVideoUrl>,
): Promise<'DOWNLOAD_AND_TRANSCRIBE' | 'ANALYZE_X'> {
  if (video?.source !== 'X') return 'DOWNLOAD_AND_TRANSCRIBE';
  const xModel = await getDefaultXAnalysisModel().catch(() => null);
  return xModel ? 'ANALYZE_X' : 'DOWNLOAD_AND_TRANSCRIBE';
}

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
    return c.json(
      { error: 'URL não suportada — use link do YouTube, Instagram, TikTok ou X.' },
      400,
    );
  }
  const jobType = await jobTypeForVideo(video);

  const existingTranscript = await db.transcript.findFirst({
    where: { userId, url: video.canonical, status: { not: 'TRASH' } },
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
        type: jobType,
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

// POST /api/jobs/auto — dispatcher unificado.
// Detecta se a URL é vídeo (YouTube/Instagram/TikTok/X) ou página web e
// roteia internamente. UI usa só este endpoint pra evitar duplicidade
// de campos / abas. Mantém /api/jobs e /api/jobs/scrape pra
// compatibilidade com clients externos / scripts.
jobsRoutes.post('/auto', async (c) => {
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
  const raw = parsed.data.url.trim();

  // 1) Tenta vídeo primeiro (mais específico — YT/IG/TT)
  const video = parseVideoUrl(raw);
  if (video) {
    const jobType = await jobTypeForVideo(video);
    const kind = jobType === 'ANALYZE_X' ? 'x' : 'video';
    const existing = await db.transcript.findFirst({
      where: { userId, url: video.canonical, status: { not: 'TRASH' } },
      select: { id: true },
    });
    if (existing) {
      return c.json(
        { error: 'Você já transcreveu esta URL.', transcriptId: existing.id, kind },
        409,
      );
    }
    const inflight = await db.job.findFirst({
      where: { userId, sourceUrl: video.canonical, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    });
    if (inflight) {
      return c.json({ error: 'Esta URL já está sendo processada.', jobId: inflight.id, kind }, 409);
    }
    let job: { id: string; status: string; sourceUrl: string };
    try {
      job = await db.job.create({
        data: {
          userId,
          type: jobType,
          status: 'QUEUED',
          sourceUrl: video.canonical,
        },
        select: { id: true, status: true, sourceUrl: true },
      });
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
        return c.json({ error: 'Esta URL já está sendo processada.', kind }, 409);
      }
      throw err;
    }
    await notifyNewJob(job.id).catch((err) => {
      console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
    });
    await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);
    return c.json({ jobId: job.id, status: job.status, sourceUrl: job.sourceUrl, kind }, 201);
  }
  // 2) Fallback: trata como página web (qualquer http(s))
  const normalized = normalizeWebUrl(raw);
  if (!normalized) {
    return c.json({ error: 'URL inválida — informe um link http(s) válido.' }, 400);
  }
  const existingWeb = await db.transcript.findFirst({
    where: { userId, url: normalized, status: { not: 'TRASH' } },
    select: { id: true },
  });
  if (existingWeb) {
    return c.json(
      { error: 'Você já indexou esta página.', transcriptId: existingWeb.id, kind: 'web' },
      409,
    );
  }
  const inflightWeb = await db.job.findFirst({
    where: { userId, sourceUrl: normalized, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true },
  });
  if (inflightWeb) {
    return c.json(
      { error: 'Esta URL já está sendo processada.', jobId: inflightWeb.id, kind: 'web' },
      409,
    );
  }
  let webJob: { id: string; status: string; sourceUrl: string };
  try {
    webJob = await db.job.create({
      data: { userId, type: 'SCRAPE_WEB', status: 'QUEUED', sourceUrl: normalized },
      select: { id: true, status: true, sourceUrl: true },
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      return c.json({ error: 'Esta URL já está sendo processada.', kind: 'web' }, 409);
    }
    throw err;
  }
  await notifyNewJob(webJob.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
  });
  await publishJobEvent(userId, { jobId: webJob.id, stage: 'queued' }).catch(() => undefined);
  return c.json(
    { jobId: webJob.id, status: webJob.status, sourceUrl: webJob.sourceUrl, kind: 'web' },
    201,
  );
});

// POST /api/jobs/upload — envia áudio/vídeo/imagem/documento para S3 e agenda processamento.
jobsRoutes.post('/upload', async (c) => {
  const userId = c.get('userId');

  if (!(await isSetupComplete())) {
    return c.json(
      { error: 'Setup incompleto. Aguarde o administrador concluir a configuração.' },
      412,
    );
  }

  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (contentLength > MAX_MEDIA_UPLOAD_REQUEST_BYTES) {
    return c.json({ error: 'Arquivo muito grande. O limite é 500 MiB.' }, 413);
  }

  const form = await c.req.formData().catch(() => null);
  const media = form?.get('media');
  if (!(media instanceof File)) {
    return c.json({ error: 'Arquivo de mídia ausente.' }, 400);
  }

  const filename = sanitizeUploadFilename(media.name);
  const contentType = media.type || 'application/octet-stream';
  const kind = detectUploadKind(filename, contentType);
  if (media.size <= 0) {
    return c.json({ error: 'Arquivo vazio.' }, 400);
  }
  if (!kind) {
    return c.json(
      { error: 'Formato não suportado. Envie áudio, vídeo, imagem ou documento.' },
      400,
    );
  }
  if (kind === 'image' && media.size > MAX_IMAGE_UPLOAD_BYTES) {
    return c.json({ error: 'Imagem muito grande. O limite é 20 MiB.' }, 413);
  }
  if (kind === 'document' && media.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return c.json({ error: 'Documento muito grande. O limite é 50 MiB.' }, 413);
  }
  if (kind === 'document') {
    const documentModel = await getSetting('default_document_model').catch(() => null);
    if (!documentModel) {
      return c.json(
        { error: 'Análise documental ainda não está configurada. Defina um modelo de documento.' },
        412,
      );
    }
  }
  if (kind === 'media' && media.size > MAX_MEDIA_UPLOAD_BYTES) {
    return c.json({ error: 'Arquivo muito grande. O limite é 500 MiB.' }, 413);
  }

  const uploadId = crypto.randomUUID();
  const sourceUrl = uploadSourceUrl(uploadId, filename);
  try {
    await putUploadFile({
      userId,
      uploadId,
      filename,
      body: new Uint8Array(await media.arrayBuffer()),
      contentType,
    });
  } catch (err) {
    console.error('[jobs] upload to S3 failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Falha ao enviar arquivo para o armazenamento S3.' }, 502);
  }

  const job = await db.job.create({
    data: {
      userId,
      type:
        kind === 'image'
          ? 'UPLOAD_AND_ANALYZE_IMAGE'
          : kind === 'document'
            ? 'UPLOAD_AND_ANALYZE_DOCUMENT'
            : 'UPLOAD_AND_TRANSCRIBE',
      status: 'QUEUED',
      sourceUrl,
    },
    select: { id: true, status: true, sourceUrl: true },
  });

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed:', err instanceof Error ? err.message : err);
  });
  await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);

  return c.json({ jobId: job.id, status: job.status, sourceUrl: job.sourceUrl, kind }, 201);
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
    where: { userId, url: normalized, status: { not: 'TRASH' } },
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
    select: { id: true, status: true, sourceUrl: true, type: true },
  });
  if (!original) {
    return c.json({ error: 'Job não encontrado.' }, 404);
  }
  if (original.status !== 'FAILED' && original.status !== 'CANCELLED') {
    return c.json({ error: 'Só é possível retentar jobs que falharam ou foram cancelados.' }, 400);
  }

  // Se já existe Transcript com esta URL pro user, não vale retentar
  const existingTranscript = await db.transcript.findFirst({
    where: { userId, url: original.sourceUrl, status: { not: 'TRASH' } },
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
        type: original.type,
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
  return sseResponse(c, async (stream) => {
    const sub = createSubscriber();
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    stream.onClose(async () => {
      if (heartbeat) clearInterval(heartbeat);
      await sub.quit().catch(() => undefined);
    });
    sub.on('error', () => {
      void stream.close();
    });

    stream.writeSSE({ event: 'connected', data: '{}', retry: SSE_RETRY_MS });
    await sub.subscribe(userChannel(userId));
    sub.on('message', (_chan, raw) => {
      if (stream.isClosed()) return;
      stream.writeSSE({ event: 'progress', data: raw });
    });

    // Keep proxies from treating the global notification stream as idle.
    stream.writeSSE({ event: 'ping', data: String(Date.now()) });
    heartbeat = setInterval(() => {
      if (stream.isClosed()) {
        if (heartbeat) clearInterval(heartbeat);
        return;
      }
      stream.writeSSE({ event: 'ping', data: String(Date.now()) });
    }, SSE_HEARTBEAT_MS);
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

  return sseResponse(c, async (stream) => {
    const sub = createSubscriber();
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    stream.onClose(async () => {
      if (heartbeat) clearInterval(heartbeat);
      await sub.quit().catch(() => undefined);
    });
    sub.on('error', () => {
      void stream.close();
    });

    // Evento inicial pra confirmar conexão (facilita debug e UI)
    stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ jobId: job.id }),
      retry: SSE_RETRY_MS,
    });

    // Job já em estado terminal: manda 1 evento e fecha
    if (job.status === 'DONE' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      stream.writeSSE({
        event: 'snapshot',
        data: JSON.stringify({ jobId: job.id, stage: job.status.toLowerCase() }),
      });
      await stream.close();
      return;
    }

    await sub.subscribe(jobChannel(userId, id));
    sub.on('message', (_chan, raw) => {
      if (stream.isClosed()) return;
      let evt: JobEvent;
      try {
        evt = JSON.parse(raw) as JobEvent;
      } catch {
        return;
      }
      stream.writeSSE({ event: 'progress', data: raw });
      if (isTerminalStage(evt.stage)) {
        void stream.close();
      }
    });

    // Heartbeat curto para Traefik/HTTP2 e proxies que fecham SSE ocioso cedo.
    stream.writeSSE({ event: 'ping', data: String(Date.now()) });
    heartbeat = setInterval(() => {
      if (stream.isClosed()) {
        if (heartbeat) clearInterval(heartbeat);
        return;
      }
      stream.writeSSE({ event: 'ping', data: String(Date.now()) });
    }, SSE_HEARTBEAT_MS);
  });
});
