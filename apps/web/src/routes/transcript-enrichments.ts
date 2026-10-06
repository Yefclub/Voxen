import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { enrichmentContract } from '../lib/enrichment-contract';
import { EnrichmentCommandError, mutateEnrichment } from '../lib/enrichment-commands';
import { enqueueKnowledgeDeletion, knowledgeDeletionHttpError } from '../lib/knowledge-deletion';
import { getSettingByKey } from '../lib/settings';
import {
  getTranscriptEnrichmentStaleReason,
  queueTranscriptResearch,
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

const QueueBody = z.object({
  requestId: z.string().uuid().optional(),
});

transcriptEnrichmentRoutes.get('/:id/enrichments', async (c) => {
  const userId = c.get('userId');
  const transcriptId = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: { not: 'TRASH' } },
    select: { id: true, sourceVersion: true, sourceChecksum: true, status: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const storedMode = (
    await getSettingByKey('summary_research_mode').catch(() => null)
  )?.toUpperCase();
  const researchMode = storedMode === 'MANUAL' || storedMode === 'AUTO' ? storedMode : 'OFF';
  const enrichments = await db.transcriptEnrichment.findMany({
    where: { userId, transcriptId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return c.json({
    enrichments: enrichments.map((row) => ({
      ...row,
      staleReason: getTranscriptEnrichmentStaleReason(row, transcript),
      ...enrichmentContract(row, transcript),
    })),
    researchMode,
  });
});

transcriptEnrichmentRoutes.get('/:transcriptId/enrichments/:enrichmentId', async (c) => {
  const existing = await db.transcriptEnrichment.findFirst({
    where: {
      id: c.req.param('enrichmentId'),
      transcriptId: c.req.param('transcriptId'),
      userId: c.get('userId'),
    },
    include: {
      transcript: { select: { sourceVersion: true, sourceChecksum: true, status: true } },
    },
  });
  if (!existing) return c.json({ error: 'Contexto adicional não encontrado.' }, 404);
  const staleReason = getTranscriptEnrichmentStaleReason(existing, existing.transcript);
  return c.json({
    enrichment: {
      ...existing,
      transcript: undefined,
      staleReason,
      ...enrichmentContract(existing, existing.transcript),
    },
  });
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

const Preconditions = z.object({
  expectedRevision: z.number().int().min(1),
  expectedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
});
const ReviewBody = z.discriminatedUnion('action', [
  Preconditions.extend({ action: z.literal('accept') }),
  Preconditions.extend({ action: z.literal('dismiss') }),
  Preconditions.extend({ action: z.literal('cancel') }),
  Preconditions.extend({
    action: z.literal('edit'),
    title: z.string().trim().min(1).max(300),
    content: z.string().trim().min(1).max(200_000),
  }),
]);

transcriptEnrichmentRoutes.patch('/:transcriptId/enrichments/:enrichmentId', async (c) => {
  const parsed = ReviewBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  try {
    const { enrichment, parent } = await mutateEnrichment({
      ...parsed.data,
      userId: c.get('userId'),
      transcriptId: c.req.param('transcriptId'),
      enrichmentId: c.req.param('enrichmentId'),
    });
    return c.json({
      enrichment: {
        ...enrichment,
        staleReason: getTranscriptEnrichmentStaleReason(enrichment, parent),
        ...enrichmentContract(enrichment, parent),
      },
    });
  } catch (error) {
    if (error instanceof EnrichmentCommandError)
      return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
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
  try {
    const result = await enqueueKnowledgeDeletion({
      userId,
      type: 'TRANSCRIPT_ENRICHMENT',
      id: existing.id,
    });
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
