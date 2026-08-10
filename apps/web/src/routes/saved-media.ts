import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { notifyNewJob, publishJobEvent } from '../lib/job-events';
import { enqueueKnowledgeDeletion, knowledgeDeletionHttpError } from '../lib/knowledge-deletion';
import { uploadSourceUrl } from '../lib/media-upload';
import { safeErrorDiagnostic } from '../lib/safe-diagnostics';
import { isSetupComplete } from '../lib/settings';
import { storageGet, storageHead } from '../lib/storage';
import { buildOriginalResponseInit, parseSingleByteRange } from '../lib/transcript-media-range';
import { parseVideoUrl } from '../lib/video-url';

type Vars = { userId: string };

export const savedMediaRoutes = new Hono<{ Variables: Vars }>();

const CreateBody = z.object({ url: z.string().min(1).max(2048) });
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_ACTIVE_DOWNLOADS = 5;

savedMediaRoutes.use('*', async (c, next) => {
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

function listNumber(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function serializeMedia(media: {
  id: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string | null;
  channel: string | null;
  author: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  byteSize: bigint | null;
  status: string;
  errorMsg: string | null;
  transcriptId: string | null;
  createdAt: Date;
  updatedAt: Date;
  readyAt: Date | null;
  processedAt: Date | null;
  jobs?: Array<{ id: string; type: string; status: string }>;
}) {
  return {
    ...media,
    byteSize: media.byteSize === null ? null : Number(media.byteSize),
  };
}

savedMediaRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = Math.max(1, listNumber(c.req.query('limit'), DEFAULT_LIMIT, MAX_LIMIT));
  const offset = listNumber(c.req.query('offset'), 0, 10_000);
  const [total, media] = await Promise.all([
    db.savedMedia.count({ where: { userId } }),
    db.savedMedia.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        sourceUrl: true,
        canonicalUrl: true,
        title: true,
        channel: true,
        author: true,
        durationSec: true,
        thumbnailUrl: true,
        filename: true,
        mimeType: true,
        byteSize: true,
        status: true,
        errorMsg: true,
        transcriptId: true,
        createdAt: true,
        updatedAt: true,
        readyAt: true,
        processedAt: true,
        jobs: {
          orderBy: { queuedAt: 'desc' },
          take: 1,
          select: { id: true, type: true, status: true },
        },
      },
    }),
  ]);
  return c.json({ items: media.map(serializeMedia), total, limit, offset });
});

savedMediaRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const video = parseVideoUrl(parsed.data.url);
  if (!video) {
    return c.json(
      { error: 'URL não suportada — use um vídeo do YouTube, Instagram, TikTok ou X.' },
      400,
    );
  }

  const existing = await db.savedMedia.findUnique({
    where: { userId_canonicalUrl: { userId, canonicalUrl: video.canonical } },
    select: { id: true, status: true },
  });
  if (existing) return c.json({ error: 'Este conteúdo já está salvo.', item: existing }, 409);

  try {
    const created = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voxen:saved-media:${userId}`}))`;
      const activeDownloads = await tx.savedMedia.count({
        where: { userId, status: { in: ['QUEUED', 'DOWNLOADING'] } },
      });
      if (activeDownloads >= MAX_ACTIVE_DOWNLOADS) return { outcome: 'limit' as const };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
      const revision = await tx.configRevision.findFirst({
        orderBy: { number: 'desc' },
        select: { id: true },
      });
      const media = await tx.savedMedia.create({
        data: {
          userId,
          sourceUrl: video.canonical,
          canonicalUrl: video.canonical,
          status: 'QUEUED',
        },
        select: { id: true, status: true },
      });
      const job = await tx.job.create({
        data: {
          userId,
          type: 'DOWNLOAD_MEDIA',
          status: 'QUEUED',
          sourceUrl: video.canonical,
          savedMediaId: media.id,
          configRevisionId: revision?.id,
        },
        select: { id: true, status: true },
      });
      return { outcome: 'created' as const, media, job };
    });
    if (created.outcome === 'limit') {
      return c.json(
        { error: `Você pode manter até ${MAX_ACTIVE_DOWNLOADS} downloads ativos por vez.` },
        429,
      );
    }
    await notifyNewJob(created.job.id).catch((error) => {
      console.error(
        '[saved-media] notify failed',
        safeErrorDiagnostic('SAVED_MEDIA_NOTIFY_FAILED', error),
      );
    });
    await publishJobEvent(userId, { jobId: created.job.id, stage: 'queued' }).catch(
      () => undefined,
    );
    return c.json({ itemId: created.media.id, jobId: created.job.id, status: 'QUEUED' }, 201);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    ) {
      return c.json({ error: 'Este conteúdo já está salvo ou em processamento.' }, 409);
    }
    throw error;
  }
});

savedMediaRoutes.post('/:id/process', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await isSetupComplete())) {
    return c.json(
      { error: 'Setup incompleto. Aguarde o administrador concluir a configuração.' },
      412,
    );
  }
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "SavedMedia" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const media = await tx.savedMedia.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        filename: true,
        transcriptId: true,
        canonicalUrl: true,
      },
    });
    if (!media) return { outcome: 'missing' as const };
    if (media.transcriptId || media.status === 'PROCESSED') {
      return { outcome: 'processed' as const, transcriptId: media.transcriptId };
    }
    if (media.status !== 'READY' || !media.filename) return { outcome: 'not_ready' as const };
    const existingTranscript = await tx.transcript.findFirst({
      where: { userId, url: media.canonicalUrl, status: { not: 'TRASH' } },
      select: { id: true },
    });
    if (existingTranscript) {
      await tx.savedMedia.update({
        where: { id: media.id },
        data: {
          status: 'PROCESSED',
          transcriptId: existingTranscript.id,
          processedAt: new Date(),
          errorMsg: null,
        },
      });
      return { outcome: 'linked' as const, transcriptId: existingTranscript.id };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
    const revision = await tx.configRevision.findFirst({
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    const job = await tx.job.create({
      data: {
        userId,
        type: 'UPLOAD_AND_TRANSCRIBE',
        status: 'QUEUED',
        sourceUrl: uploadSourceUrl(media.id, media.filename),
        savedMediaId: media.id,
        configRevisionId: revision?.id,
      },
      select: { id: true },
    });
    await tx.savedMedia.update({
      where: { id: media.id },
      data: { status: 'PROCESSING', errorMsg: null },
    });
    return { outcome: 'created' as const, jobId: job.id };
  });

  if (result.outcome === 'missing') return c.json({ error: 'Mídia não encontrada.' }, 404);
  if (result.outcome === 'processed') {
    return c.json(
      { error: 'Esta mídia já foi processada.', transcriptId: result.transcriptId },
      409,
    );
  }
  if (result.outcome === 'linked') {
    return c.json({ transcriptId: result.transcriptId, status: 'PROCESSED' }, 200);
  }
  if (result.outcome === 'not_ready') {
    return c.json({ error: 'A mídia ainda não está pronta para processamento.' }, 409);
  }
  await notifyNewJob(result.jobId).catch(() => undefined);
  await publishJobEvent(userId, { jobId: result.jobId, stage: 'queued' }).catch(() => undefined);
  return c.json({ jobId: result.jobId, status: 'QUEUED' }, 201);
});

savedMediaRoutes.get('/:id/content', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const media = await db.savedMedia.findFirst({
    where: { id, userId },
    select: { objectKey: true, filename: true, mimeType: true },
  });
  if (!media?.objectKey || !media.filename) return c.json({ error: 'Mídia não encontrada.' }, 404);
  const rawRange = c.req.header('range');
  const rangeHeader = rawRange && !rawRange.includes(',') ? rawRange : undefined;
  try {
    const head = await storageHead(media.objectKey);
    const range = rangeHeader ? parseSingleByteRange(rangeHeader, head.contentLength) : null;
    if (rangeHeader && !range) {
      return new Response(JSON.stringify({ error: 'Range solicitado inválido.' }), {
        status: 416,
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'accept-ranges': 'bytes',
          'content-range': `bytes */${head.contentLength}`,
        },
      });
    }
    const object = await storageGet(media.objectKey, range ?? undefined);
    return new Response(
      object.body,
      buildOriginalResponseInit({
        rangeHeader,
        storageContentType: object.contentType ?? undefined,
        storageContentLength: object.contentLength,
        storageContentRange: object.contentRange ?? undefined,
        fallbackMime: media.mimeType,
        filename: media.filename.replace(/[\\/\r\n"]/g, '_').slice(0, 160),
      }),
    );
  } catch (error) {
    console.error(
      '[saved-media] stream failed',
      safeErrorDiagnostic('SAVED_MEDIA_STREAM_FAILED', error),
    );
    return c.json({ error: 'Falha ao baixar a mídia.' }, 502);
  }
});

savedMediaRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const result = await enqueueKnowledgeDeletion({ userId, type: 'SAVED_MEDIA', id });
    return c.json(
      {
        ok: true,
        queued: true,
        jobId: result.job.id,
        target: result.target,
        reused: !result.created,
      },
      202,
    );
  } catch (error) {
    return knowledgeDeletionHttpError(error) ?? Promise.reject(error);
  }
});
