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
  MAX_MEDIA_UPLOAD_REQUEST_BYTES,
  detectUploadKind,
  maxBytesForKind,
  putUploadFile,
  sanitizeUploadFilename,
  tooLargeMessageForKind,
  uploadObjectKey,
  uploadSourceUrl,
  type UploadKind,
} from '../lib/media-upload';
import { storageCreateDirectUpload, storageDelete, storageHead } from '../lib/storage';
import { rateLimit } from '../lib/rate-limit';
import { createSubscriber } from '../lib/redis';
import { safeErrorDiagnostic } from '../lib/safe-diagnostics';
import { createQueuedJob, retryQueuedJobForUser } from '../lib/job-queue';
import { cancelActiveSavedMediaJob } from '../lib/saved-media-lifecycle';
import {
  isTerminalStage,
  jobChannel,
  notifyNewJob,
  publishJobEvent,
  requestCancel,
  userChannel,
  type JobEvent,
} from '../lib/job-events';
import { registerDirectUploadRoute } from './jobs-direct-upload';

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
registerDirectUploadRoute(jobsRoutes);

const PostBody = z.object({
  url: z.string().min(1).max(2048),
});
const BatchPostBody = z.object({
  urls: z.array(z.string().min(1).max(2048)).min(1).max(20),
});

export type AutoJobKind = 'video' | 'web' | 'x';

export type AutoJobResult =
  | {
      outcome: 'created';
      jobId: string;
      status: string;
      sourceUrl: string;
      kind: AutoJobKind;
    }
  | {
      outcome: 'existing_transcript';
      transcriptId: string;
      kind: AutoJobKind;
      error: string;
    }
  | {
      outcome: 'inflight';
      jobId?: string;
      kind: AutoJobKind;
      error: string;
    }
  | { outcome: 'invalid'; error: string }
  | { outcome: 'setup_incomplete'; error: string };

export type BatchAutoJobResult = AutoJobResult | { outcome: 'error'; error: string };

export type BatchAutoJobItem = {
  index: number;
  input: string;
  result: BatchAutoJobResult;
};

export type UploadJobResult =
  | {
      outcome: 'created';
      jobId: string;
      status: string;
      sourceUrl: string;
      kind: 'media' | 'image' | 'document';
    }
  | { outcome: 'error'; status: 400 | 412 | 413 | 502; error: string };

export async function createAutoJobForUser(userId: string, rawUrl: string): Promise<AutoJobResult> {
  if (!(await isSetupComplete())) {
    return {
      outcome: 'setup_incomplete',
      error: 'Setup incompleto. Aguarde o administrador concluir a configuração.',
    };
  }

  const raw = rawUrl.trim();

  // 1) Tenta vídeo primeiro (mais específico — YT/IG/TT/X).
  const video = parseVideoUrl(raw);
  if (video) {
    const jobType = await jobTypeForVideo(video);
    const kind: AutoJobKind = jobType === 'ANALYZE_X' ? 'x' : 'video';
    const existing = await db.transcript.findFirst({
      where: { userId, url: video.canonical, status: { not: 'TRASH' } },
      select: { id: true },
    });
    if (existing) {
      return {
        outcome: 'existing_transcript',
        error: 'Você já transcreveu esta URL.',
        transcriptId: existing.id,
        kind,
      };
    }
    const inflight = await db.job.findFirst({
      where: { userId, sourceUrl: video.canonical, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    });
    if (inflight) {
      return {
        outcome: 'inflight',
        error: 'Esta URL já está sendo processada.',
        jobId: inflight.id,
        kind,
      };
    }
    let job: { id: string; status: string; sourceUrl: string };
    try {
      job = await createQueuedJob(userId, jobType, video.canonical);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
        return { outcome: 'inflight', error: 'Esta URL já está sendo processada.', kind };
      }
      throw err;
    }
    await notifyNewJob(job.id).catch((err) => {
      console.error('[jobs] notifyNewJob failed', safeErrorDiagnostic('JOB_NOTIFY_FAILED', err));
    });
    await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);
    return {
      outcome: 'created',
      jobId: job.id,
      status: job.status,
      sourceUrl: job.sourceUrl,
      kind,
    };
  }

  // 2) Fallback: trata como página web (qualquer http(s)).
  const normalized = normalizeWebUrl(raw);
  if (!normalized) {
    return { outcome: 'invalid', error: 'URL inválida — informe um link http(s) válido.' };
  }
  const existingWeb = await db.transcript.findFirst({
    where: { userId, url: normalized, status: { not: 'TRASH' } },
    select: { id: true },
  });
  if (existingWeb) {
    return {
      outcome: 'existing_transcript',
      error: 'Você já indexou esta página.',
      transcriptId: existingWeb.id,
      kind: 'web',
    };
  }
  const inflightWeb = await db.job.findFirst({
    where: { userId, sourceUrl: normalized, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true },
  });
  if (inflightWeb) {
    return {
      outcome: 'inflight',
      error: 'Esta URL já está sendo processada.',
      jobId: inflightWeb.id,
      kind: 'web',
    };
  }
  let webJob: { id: string; status: string; sourceUrl: string };
  try {
    webJob = await createQueuedJob(userId, 'SCRAPE_WEB', normalized);
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      return { outcome: 'inflight', error: 'Esta URL já está sendo processada.', kind: 'web' };
    }
    throw err;
  }
  await notifyNewJob(webJob.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed', safeErrorDiagnostic('JOB_NOTIFY_FAILED', err));
  });
  await publishJobEvent(userId, { jobId: webJob.id, stage: 'queued' }).catch(() => undefined);
  return {
    outcome: 'created',
    jobId: webJob.id,
    status: webJob.status,
    sourceUrl: webJob.sourceUrl,
    kind: 'web',
  };
}

export async function createAutoJobsForUser(
  userId: string,
  urls: readonly string[],
): Promise<BatchAutoJobItem[]> {
  const items: BatchAutoJobItem[] = [];
  for (const [index, input] of urls.entries()) {
    try {
      items.push({ index, input, result: await createAutoJobForUser(userId, input) });
    } catch (error) {
      console.error('[jobs] batch item failed', safeErrorDiagnostic('BATCH_ITEM_FAILED', error));
      items.push({
        index,
        input,
        result: { outcome: 'error', error: 'Não foi possível enfileirar este conteúdo.' },
      });
    }
  }
  return items;
}

function jobTypeForKind(
  kind: UploadKind,
): 'UPLOAD_AND_ANALYZE_IMAGE' | 'UPLOAD_AND_ANALYZE_DOCUMENT' | 'UPLOAD_AND_TRANSCRIBE' {
  if (kind === 'image') return 'UPLOAD_AND_ANALYZE_IMAGE';
  if (kind === 'document') return 'UPLOAD_AND_ANALYZE_DOCUMENT';
  return 'UPLOAD_AND_TRANSCRIBE';
}

/**
 * Cria + enfileira o job de upload. Pré-requisito: o objeto já está no S3 sob a
 * key `uploadObjectKey(userId, uploadId, filename)`. Compartilhado entre o
 * upload via app (`createUploadJobForUser`) e o confirm do fluxo presigned.
 */
async function enqueueUploadJob(
  userId: string,
  uploadId: string,
  filename: string,
  kind: UploadKind,
): Promise<{ jobId: string; status: string; sourceUrl: string }> {
  const sourceUrl = uploadSourceUrl(uploadId, filename);
  const job = await createQueuedJob(userId, jobTypeForKind(kind), sourceUrl);

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed', safeErrorDiagnostic('JOB_NOTIFY_FAILED', err));
  });
  await publishJobEvent(userId, { jobId: job.id, stage: 'queued' }).catch(() => undefined);

  return { jobId: job.id, status: job.status, sourceUrl: job.sourceUrl };
}

export async function createUploadJobForUser(
  userId: string,
  media: File,
): Promise<UploadJobResult> {
  if (!(await isSetupComplete())) {
    return {
      outcome: 'error',
      status: 412,
      error: 'Setup incompleto. Aguarde o administrador concluir a configuração.',
    };
  }

  const filename = sanitizeUploadFilename(media.name);
  const contentType = media.type || 'application/octet-stream';
  const kind = detectUploadKind(filename, contentType);
  if (media.size <= 0) {
    return { outcome: 'error', status: 400, error: 'Arquivo vazio.' };
  }
  if (!kind) {
    return {
      outcome: 'error',
      status: 400,
      error: 'Formato não suportado. Envie áudio, vídeo, imagem ou documento.',
    };
  }
  if (media.size > maxBytesForKind(kind)) {
    return { outcome: 'error', status: 413, error: tooLargeMessageForKind(kind) };
  }
  if (kind === 'document') {
    const documentModel = await getSetting('default_document_model').catch(() => null);
    if (!documentModel) {
      return {
        outcome: 'error',
        status: 412,
        error: 'Análise documental ainda não está configurada. Defina um modelo de documento.',
      };
    }
  }

  const uploadId = crypto.randomUUID();
  try {
    await putUploadFile({
      userId,
      uploadId,
      filename,
      body: new Uint8Array(await media.arrayBuffer()),
      contentType,
    });
  } catch (err) {
    console.error('[jobs] upload to S3 failed', safeErrorDiagnostic('UPLOAD_STORE_FAILED', err));
    return {
      outcome: 'error',
      status: 502,
      error: 'Falha ao enviar arquivo para o armazenamento S3.',
    };
  }

  const enqueued = await enqueueUploadJob(userId, uploadId, filename, kind);
  return { outcome: 'created', ...enqueued, kind };
}

function autoJobResponse(c: Context, result: AutoJobResult): Response {
  if (result.outcome === 'created') {
    return c.json(
      {
        jobId: result.jobId,
        status: result.status,
        sourceUrl: result.sourceUrl,
        kind: result.kind,
      },
      201,
    );
  }
  if (result.outcome === 'existing_transcript') {
    return c.json(
      { error: result.error, transcriptId: result.transcriptId, kind: result.kind },
      409,
    );
  }
  if (result.outcome === 'inflight') {
    return c.json({ error: result.error, jobId: result.jobId, kind: result.kind }, 409);
  }
  if (result.outcome === 'setup_incomplete') {
    return c.json({ error: result.error }, 412);
  }
  return c.json({ error: result.error }, 400);
}

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
    job = await createQueuedJob(userId, jobType, video.canonical);
  } catch (err) {
    // Partial unique index `Job_user_url_active_unique` cobre a race entre
    // 2 POSTs simultâneos da mesma URL: o primeiro cria, o segundo cai aqui.
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
    }
    throw err;
  }

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed', safeErrorDiagnostic('JOB_NOTIFY_FAILED', err));
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

  const parsed = PostBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }
  return autoJobResponse(c, await createAutoJobForUser(userId, parsed.data.url));
});

jobsRoutes.post('/batch', async (c) => {
  const userId = c.get('userId');
  const parsed = BatchPostBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Informe entre 1 e 20 URLs válidas.' }, 400);
  return c.json({ items: await createAutoJobsForUser(userId, parsed.data.urls) });
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

  const result = await createUploadJobForUser(userId, media);
  if (result.outcome === 'error') {
    return c.json({ error: result.error }, result.status);
  }
  return c.json(
    {
      jobId: result.jobId,
      status: result.status,
      sourceUrl: result.sourceUrl,
      kind: result.kind,
    },
    201,
  );
});

// Limites do presign por user (anti-abuso acidental, não quota comercial).
const PRESIGN_MAX_PER_MINUTE = 30;
const PRESIGN_EXPIRES_SEC = 300;

const PresignBody = z.object({
  filename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const ConfirmBody = z.object({
  uploadId: z.string().uuid(),
  filename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
});

// POST /api/jobs/upload/presign — prepares the best upload transport. Public
// S3 gets a presigned URL; local/private S3 gets a same-origin streaming PUT.
jobsRoutes.post('/upload/presign', async (c) => {
  const userId = c.get('userId');

  if (!(await isSetupComplete())) {
    return c.json(
      { error: 'Setup incompleto. Aguarde o administrador concluir a configuração.' },
      412,
    );
  }

  const rl = await rateLimit(`voxen:rl:presign:${userId}`, PRESIGN_MAX_PER_MINUTE, 60);
  if (!rl.allowed) {
    return c.json({ error: 'Muitas solicitações de upload. Tente novamente em instantes.' }, 429);
  }

  const parsed = PresignBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }

  const filename = sanitizeUploadFilename(parsed.data.filename);
  const contentType = parsed.data.contentType || 'application/octet-stream';
  const kind = detectUploadKind(filename, contentType);
  if (!kind) {
    return c.json(
      { error: 'Formato não suportado. Envie áudio, vídeo, imagem ou documento.' },
      400,
    );
  }
  if (parsed.data.size <= 0) {
    return c.json({ error: 'Arquivo vazio.' }, 400);
  }
  if (parsed.data.size > maxBytesForKind(kind)) {
    return c.json({ error: tooLargeMessageForKind(kind) }, 413);
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

  // Key SEMPRE derivada do userId da sessão + uploadId aleatório — o client
  // nunca escolhe o path (impede escrita em workspace alheio).
  const uploadId = crypto.randomUUID();
  const key = uploadObjectKey(userId, uploadId, filename);

  let url: string;
  try {
    url =
      (await storageCreateDirectUpload({
        key,
        contentType,
        expiresIn: PRESIGN_EXPIRES_SEC,
      })) ?? `/api/jobs/upload/direct/${uploadId}?filename=${encodeURIComponent(filename)}`;
  } catch (err) {
    console.error('[jobs] presign failed', {
      upload_id: uploadId,
      content_kind: kind,
      ...safeErrorDiagnostic('UPLOAD_PRESIGN_FAILED', err),
    });
    return c.json({ error: 'Falha ao gerar URL de upload.' }, 502);
  }

  return c.json({
    enabled: true,
    uploadId,
    sourceUrl: uploadSourceUrl(uploadId, filename),
    key,
    url,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    expiresIn: PRESIGN_EXPIRES_SEC,
  });
});

// POST /api/jobs/upload/confirm — confirma um upload presigned e enfileira o job.
// Valida por HeadObject (existência + tamanho REAL, não o size informado pelo
// client) antes de criar o job.
jobsRoutes.post('/upload/confirm', async (c) => {
  const userId = c.get('userId');

  if (!(await isSetupComplete())) {
    return c.json(
      { error: 'Setup incompleto. Aguarde o administrador concluir a configuração.' },
      412,
    );
  }

  const parsed = ConfirmBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Payload inválido.' }, 400);
  }

  const filename = sanitizeUploadFilename(parsed.data.filename);
  const contentType = parsed.data.contentType || 'application/octet-stream';
  const kind = detectUploadKind(filename, contentType);
  if (!kind) {
    return c.json(
      { error: 'Formato não suportado. Envie áudio, vídeo, imagem ou documento.' },
      400,
    );
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

  // Key derivada do userId da sessão — o client não pode apontar pra outro path.
  const key = uploadObjectKey(userId, parsed.data.uploadId, filename);

  let contentLength: number;
  try {
    const head = await storageHead(key);
    contentLength = head.contentLength;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotFound' || name === 'NoSuchKey') {
      return c.json({ error: 'Upload não encontrado. Reenvie o arquivo.' }, 400);
    }
    console.error('[jobs] confirm HeadObject failed', {
      upload_id: parsed.data.uploadId,
      content_kind: kind,
      ...safeErrorDiagnostic('UPLOAD_HEAD_FAILED', err),
    });
    return c.json({ error: 'Falha ao validar upload no armazenamento.' }, 502);
  }

  if (contentLength <= 0) {
    await storageDelete(key).catch(() => undefined);
    return c.json({ error: 'Arquivo vazio.' }, 400);
  }
  // Tamanho REAL do objeto (não confiar no size informado no presign).
  if (contentLength > maxBytesForKind(kind)) {
    await storageDelete(key).catch(() => undefined);
    return c.json({ error: tooLargeMessageForKind(kind) }, 413);
  }

  const enqueued = await enqueueUploadJob(userId, parsed.data.uploadId, filename, kind);
  return c.json(
    { jobId: enqueued.jobId, status: enqueued.status, sourceUrl: enqueued.sourceUrl, kind },
    201,
  );
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
    job = await createQueuedJob(userId, 'SCRAPE_WEB', normalized);
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'P2002') {
      return c.json({ error: 'Esta URL já está sendo processada.' }, 409);
    }
    throw err;
  }

  await notifyNewJob(job.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed', safeErrorDiagnostic('JOB_NOTIFY_FAILED', err));
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
  const pageRaw = Number(c.req.query('page') ?? '1');
  const limitRaw = Number(c.req.query('limit') ?? '10');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 50 ? Math.floor(limitRaw) : 10;
  const skip = (page - 1) * limit;

  const [total, jobs] = await Promise.all([
    db.job.count({ where: { userId } }),
    db.job.findMany({
      where: { userId },
      orderBy: { queuedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        sourceUrl: true,
        errorMsg: true,
        transcriptId: true,
        progressStage: true,
        progressPercent: true,
        progressedAt: true,
        queuedAt: true,
        startedAt: true,
        finishedAt: true,
        transcript: {
          select: {
            title: true,
            thumbnailUrl: true,
            source: true,
            durationSec: true,
          },
        },
        savedMedia: {
          select: { id: true, title: true, thumbnailUrl: true, durationSec: true },
        },
      },
    }),
  ]);

  return c.json({
    jobs: jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      sourceUrl: job.sourceUrl,
      errorMsg: job.errorMsg,
      transcriptId: job.transcriptId,
      progressStage: job.progressStage,
      progressPercent: job.progressPercent,
      progressedAt: job.progressedAt,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      title: job.transcript?.title ?? job.savedMedia?.title ?? null,
      thumbnailUrl: job.transcript?.thumbnailUrl ?? job.savedMedia?.thumbnailUrl ?? null,
      transcriptSource: job.transcript?.source ?? null,
      durationSec: job.transcript?.durationSec ?? job.savedMedia?.durationSec ?? null,
      savedMediaId: job.savedMedia?.id ?? null,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

jobsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const job = await db.job.findFirst({
    where: { id, userId },
    select: {
      id: true,
      type: true,
      status: true,
      sourceUrl: true,
      errorMsg: true,
      transcriptId: true,
      progressStage: true,
      progressPercent: true,
      progressedAt: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      transcript: {
        select: {
          id: true,
          title: true,
          summaryMd: true,
          source: true,
          thumbnailUrl: true,
        },
      },
      savedMedia: {
        select: { id: true, title: true, thumbnailUrl: true },
      },
      progressEvents: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 120,
        select: {
          id: true,
          stage: true,
          percent: true,
          chunkIndex: true,
          transcriptId: true,
          errorMsg: true,
          createdAt: true,
        },
      },
    },
  });
  if (!job) {
    // 404 (não 403) — evita vazar existência cross-workspace
    return c.json({ error: 'Job não encontrado.' }, 404);
  }
  // Resumo curto pra extensão / notificações (sem vazar markdown enorme).
  const summary = job.transcript?.summaryMd?.trim().replace(/\s+/g, ' ').slice(0, 280) || null;
  return c.json({
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      sourceUrl: job.sourceUrl,
      errorMsg: job.errorMsg,
      transcriptId: job.transcriptId,
      progressStage: job.progressStage,
      progressPercent: job.progressPercent,
      progressedAt: job.progressedAt,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      title: job.transcript?.title ?? job.savedMedia?.title ?? null,
      summary,
      transcriptSource: job.transcript?.source ?? null,
      thumbnailUrl: job.transcript?.thumbnailUrl ?? job.savedMedia?.thumbnailUrl ?? null,
      savedMediaId: job.savedMedia?.id ?? null,
      events: [...job.progressEvents].reverse().map((event) => ({
        id: event.id,
        jobId: job.id,
        stage: event.stage,
        percent: event.percent,
        chunkIndex: event.chunkIndex,
        transcriptId: event.transcriptId,
        errorMsg: event.errorMsg,
        ts: event.createdAt.toISOString(),
      })),
    },
  });
});

jobsRoutes.post('/:id/retry', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const result = await retryQueuedJobForUser(userId, id);
  if (result.outcome === 'missing') return c.json({ error: 'Job não encontrado.' }, 404);
  if (result.outcome === 'invalid_state') {
    return c.json({ error: 'Só é possível retentar jobs que falharam ou foram cancelados.' }, 400);
  }
  if (result.outcome === 'existing_transcript') {
    return c.json(
      { error: 'Você já transcreveu esta URL.', transcriptId: result.transcriptId },
      409,
    );
  }
  if (result.outcome === 'media_unavailable') {
    return c.json({ error: 'A mídia não está disponível neste estado para nova tentativa.' }, 409);
  }
  if (result.outcome === 'inflight') {
    return result.jobId
      ? c.json({ jobId: result.jobId, status: result.status, sourceUrl: result.sourceUrl }, 200)
      : c.json({ error: 'Esta URL já está sendo processada.' }, 409);
  }
  const newJob = { id: result.jobId, status: result.status, sourceUrl: result.sourceUrl };

  await notifyNewJob(newJob.id).catch((err) => {
    console.error('[jobs] notifyNewJob failed', safeErrorDiagnostic('JOB_NOTIFY_FAILED', err));
  });
  await publishJobEvent(userId, { jobId: newJob.id, stage: 'queued' }).catch(() => undefined);

  return c.json({ jobId: newJob.id, status: newJob.status, sourceUrl: newJob.sourceUrl }, 201);
});

// POST /api/jobs/:id/enrichment-retry — reaproveita a transcrição persistida.
jobsRoutes.post('/:id/enrichment-retry', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const job = await db.job.findFirst({
    where: { id, userId, status: 'COMPLETED_WITH_WARNINGS' },
    select: { id: true, transcriptId: true },
  });
  if (!job?.transcriptId) {
    return c.json({ error: 'Não há enriquecimentos pendentes para este job.' }, 400);
  }
  const transcript = await db.transcript.findFirst({
    where: { id: job.transcriptId, userId },
    select: { summaryStatus: true, taggingStatus: true },
  });
  if (!transcript) return c.json({ error: 'Conteúdo não encontrado.' }, 404);
  await db.$transaction([
    db.transcript.update({
      where: { id: job.transcriptId },
      data: {
        ...(transcript.summaryStatus !== 'COMPLETE' && transcript.summaryStatus !== 'SKIPPED'
          ? { summaryStatus: 'RETRY', summaryNextAttemptAt: new Date() }
          : {}),
        ...(transcript.taggingStatus !== 'COMPLETE' && transcript.taggingStatus !== 'SKIPPED'
          ? { taggingStatus: 'RETRY', taggingNextAttemptAt: new Date() }
          : {}),
      },
    }),
    db.job.update({
      where: { id },
      data: {
        status: 'QUEUED',
        errorMsg: null,
        progressStage: 'queued',
        progressPercent: 0,
        progressedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
      },
    }),
  ]);
  await notifyNewJob(id).catch(() => undefined);
  await publishJobEvent(userId, {
    jobId: id,
    stage: 'queued',
    transcriptId: job.transcriptId,
  }).catch(() => undefined);
  return c.json({ jobId: id, transcriptId: job.transcriptId, status: 'QUEUED' });
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
    select: { id: true, status: true, type: true, savedMediaId: true },
  });
  if (!job) {
    return c.json({ error: 'Job não encontrado.' }, 404);
  }
  if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
    return c.json({ error: 'Só é possível cancelar jobs ativos.' }, 400);
  }
  const cancelled = await cancelActiveSavedMediaJob(userId, job);
  if (!cancelled) {
    return c.json({ error: 'Só é possível cancelar jobs ativos.' }, 400);
  }
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
    select: { id: true },
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

    await sub.subscribe(jobChannel(userId, id));
    const pending: string[] = [];
    let snapshotSent = false;
    sub.on('message', (_chan, raw) => {
      if (stream.isClosed()) return;
      if (!snapshotSent) {
        pending.push(raw);
        return;
      }
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

    // Assina antes da leitura e mantém eventos em buffer até o snapshot ser
    // enviado. Assim, uma publicação entre os dois passos não se perde.
    const snapshot = await db.job.findFirst({
      where: { id, userId },
      select: {
        id: true,
        type: true,
        status: true,
        progressStage: true,
        progressPercent: true,
        progressedAt: true,
        transcriptId: true,
        errorMsg: true,
        progressEvents: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 120,
          select: {
            id: true,
            stage: true,
            percent: true,
            chunkIndex: true,
            transcriptId: true,
            errorMsg: true,
            createdAt: true,
          },
        },
      },
    });
    if (!snapshot) {
      await stream.close();
      return;
    }
    stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ jobId: snapshot.id }),
      retry: SSE_RETRY_MS,
    });
    stream.writeSSE({
      event: 'snapshot',
      data: JSON.stringify({
        jobId: snapshot.id,
        type: snapshot.type,
        stage: snapshot.progressStage ?? snapshot.status.toLowerCase(),
        percent:
          snapshot.progressPercent ??
          (snapshot.status === 'DONE' || snapshot.status === 'COMPLETED_WITH_WARNINGS' ? 100 : 0),
        transcriptId: snapshot.transcriptId,
        errorMsg: snapshot.errorMsg,
        ts: (snapshot.progressedAt ?? new Date()).toISOString(),
        events: [...snapshot.progressEvents].reverse().map((event) => ({
          id: event.id,
          jobId: snapshot.id,
          stage: event.stage,
          percent: event.percent ?? undefined,
          chunkIndex: event.chunkIndex ?? undefined,
          transcriptId: event.transcriptId ?? undefined,
          errorMsg: event.errorMsg ?? undefined,
          ts: event.createdAt.toISOString(),
        })),
      }),
    });
    snapshotSent = true;
    for (const raw of pending) {
      if (stream.isClosed()) break;
      let evt: JobEvent;
      try {
        evt = JSON.parse(raw) as JobEvent;
      } catch {
        continue;
      }
      stream.writeSSE({ event: 'progress', data: raw });
      if (isTerminalStage(evt.stage)) {
        await stream.close();
        return;
      }
    }

    // Job já em estado terminal: o snapshot é suficiente.
    if (
      snapshot.status === 'DONE' ||
      snapshot.status === 'COMPLETED_WITH_WARNINGS' ||
      snapshot.status === 'FAILED' ||
      snapshot.status === 'CANCELLED'
    ) {
      await stream.close();
      return;
    }

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
