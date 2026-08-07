import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { deleteBrainForSource } from '../lib/brain';
import { reindexTranscriptEnrichmentBrain } from '../lib/brain-enrichments';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';
import { getSettingByKey } from '../lib/settings';
import {
  getTranscriptEnrichmentStaleReason,
  queueTranscriptResearch,
  refreshTranscriptEnrichmentFreshness,
  TranscriptResearchQueueError,
} from '../lib/transcript-enrichments';

type Vars = { userId: string };

export const transcriptEnrichmentRoutes = new Hono<{ Variables: Vars }>();

transcriptEnrichmentRoutes.use('*', async (c, next) => {
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

const CitationSchema = z.object({
  url: z
    .string()
    .url()
    .max(2_048)
    .refine((value) => /^https?:\/\//i.test(value)),
  title: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().min(1).max(4_000),
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
});

const QueueBody = z.object({
  requestId: z.string().uuid().optional(),
});

transcriptEnrichmentRoutes.get('/:id/enrichments', async (c) => {
  const userId = c.get('userId');
  const transcriptId = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: { not: 'TRASH' } },
    select: { id: true, sourceVersion: true, sourceChecksum: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const staleAcceptedIds = await refreshTranscriptEnrichmentFreshness({
    userId,
    transcriptId,
    sourceVersion: transcript.sourceVersion,
    sourceChecksum: transcript.sourceChecksum,
  });
  await Promise.all(
    staleAcceptedIds.map((id) => deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', id)),
  );
  if (staleAcceptedIds.length > 0) await invalidateGraphCache(userId);
  const storedMode = (
    await getSettingByKey('summary_research_mode').catch(() => null)
  )?.toUpperCase();
  const researchMode = storedMode === 'MANUAL' || storedMode === 'AUTO' ? storedMode : 'OFF';
  const enrichments = await db.transcriptEnrichment.findMany({
    where: { userId, transcriptId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return c.json({ enrichments, researchMode });
});

transcriptEnrichmentRoutes.get('/:transcriptId/enrichments/:enrichmentId', async (c) => {
  const existing = await db.transcriptEnrichment.findFirst({
    where: {
      id: c.req.param('enrichmentId'),
      transcriptId: c.req.param('transcriptId'),
      userId: c.get('userId'),
    },
    include: { transcript: { select: { sourceVersion: true, sourceChecksum: true } } },
  });
  if (!existing) return c.json({ error: 'Contexto adicional não encontrado.' }, 404);
  const staleReason = getTranscriptEnrichmentStaleReason(existing, existing.transcript);
  const enrichment = staleReason
    ? await db.transcriptEnrichment.update({
        where: { id: existing.id },
        data: { staleReason },
      })
    : existing;
  if (staleReason && existing.reviewState === 'ACCEPTED') {
    await deleteBrainForSource(c.get('userId'), 'EXTERNAL_ENRICHMENT', existing.id);
    await invalidateGraphCache(c.get('userId'));
  }
  return c.json({ enrichment });
});

transcriptEnrichmentRoutes.post('/:id/enrichments', async (c) => {
  const userId = c.get('userId');
  const transcriptId = c.req.param('id');
  const parsed = QueueBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  try {
    const enrichment = await queueTranscriptResearch({
      userId,
      transcriptId,
      trigger: 'MANUAL',
      requestId: parsed.data.requestId,
    });
    return c.json({ enrichment }, 202);
  } catch (error) {
    if (error instanceof TranscriptResearchQueueError) {
      return c.json({ error: error.message }, error.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw error;
  }
});

const ReviewBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('dismiss') }),
  z.object({ action: z.literal('cancel') }),
  z.object({
    action: z.literal('edit'),
    title: z.string().trim().min(1).max(300),
    content: z.string().trim().min(1).max(200_000),
  }),
]);

transcriptEnrichmentRoutes.patch('/:transcriptId/enrichments/:enrichmentId', async (c) => {
  const userId = c.get('userId');
  const transcriptId = c.req.param('transcriptId');
  const enrichmentId = c.req.param('enrichmentId');
  const parsed = ReviewBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const existing = await db.transcriptEnrichment.findFirst({
    where: { id: enrichmentId, transcriptId, userId },
    include: { transcript: { select: { sourceVersion: true, sourceChecksum: true } } },
  });
  if (!existing) return c.json({ error: 'Contexto adicional não encontrado.' }, 404);

  if (parsed.data.action === 'accept') {
    if (existing.status !== 'READY')
      return c.json({ error: 'O contexto ainda não está pronto.' }, 409);
    const staleReason = getTranscriptEnrichmentStaleReason(existing, existing.transcript);
    if (staleReason) {
      if (!existing.staleReason) {
        await db.transcriptEnrichment.update({ where: { id: existing.id }, data: { staleReason } });
      }
      return c.json({ error: 'O contexto está desatualizado.' }, 409);
    }
    if (!CitationSchema.array().min(1).max(12).safeParse(existing.citations).success) {
      return c.json({ error: 'O contexto não possui citações utilizáveis.' }, 422);
    }
    const enrichment = await db.transcriptEnrichment.update({
      where: { id: existing.id },
      data: { reviewState: 'ACCEPTED', acceptedAt: new Date(), dismissedAt: null },
    });
    await reindexTranscriptEnrichmentBrain(userId, enrichment.id);
    await invalidateGraphCache(userId);
    return c.json({ enrichment });
  }

  if (parsed.data.action === 'dismiss') {
    const enrichment = await db.transcriptEnrichment.update({
      where: { id: existing.id },
      data: { reviewState: 'DISMISSED', dismissedAt: new Date(), acceptedAt: null },
    });
    await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', enrichment.id);
    await invalidateGraphCache(userId);
    return c.json({ enrichment });
  }

  if (parsed.data.action === 'cancel') {
    if (!['PENDING', 'RUNNING', 'RETRY'].includes(existing.status)) {
      return c.json({ error: 'A execução já foi concluída.' }, 409);
    }
    const enrichment = await db.transcriptEnrichment.update({
      where: { id: existing.id },
      data: { cancelRequestedAt: new Date() },
    });
    return c.json({ enrichment });
  }

  if (existing.status !== 'READY')
    return c.json({ error: 'O contexto ainda não está pronto.' }, 409);
  const enrichment = await db.transcriptEnrichment.update({
    where: { id: existing.id },
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      editedAt: new Date(),
    },
  });
  if (enrichment.reviewState === 'ACCEPTED') {
    await reindexTranscriptEnrichmentBrain(userId, enrichment.id);
    await invalidateGraphCache(userId);
  }
  return c.json({ enrichment });
});

transcriptEnrichmentRoutes.delete('/:transcriptId/enrichments/:enrichmentId', async (c) => {
  const userId = c.get('userId');
  const transcriptId = c.req.param('transcriptId');
  const enrichmentId = c.req.param('enrichmentId');
  const existing = await db.transcriptEnrichment.findFirst({
    where: { id: enrichmentId, transcriptId, userId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: 'Contexto adicional não encontrado.' }, 404);
  await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', existing.id);
  await db.transcriptEnrichment.delete({ where: { id: existing.id } });
  await invalidateGraphCache(userId);
  return c.json({ ok: true });
});
