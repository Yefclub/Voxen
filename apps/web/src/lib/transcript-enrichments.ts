import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { getSettingByKey } from './settings';

export class TranscriptResearchQueueError extends Error {
  constructor(
    public readonly code: 'DISABLED' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptResearchQueueError';
  }
}

type EnrichmentFreshnessInput = {
  staleReason: string | null;
  sourceVersion: number;
  sourceChecksum: string | null;
  expiresAt: Date | null;
};

type TranscriptFreshnessInput = {
  sourceVersion: number;
  sourceChecksum: string | null;
};

export type NormalizedTranscriptEnrichmentCitation = {
  url: string;
  title: string;
  excerpt: string;
};

export function normalizeTranscriptEnrichmentCitations(
  value: unknown,
): NormalizedTranscriptEnrichmentCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const citation = candidate as Record<string, unknown>;
    const url = typeof citation.url === 'string' ? citation.url : '';
    const title = typeof citation.title === 'string' ? citation.title : '';
    const excerpt = typeof citation.excerpt === 'string' ? citation.excerpt : '';
    try {
      const parsed = new URL(url);
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !title || !excerpt) {
        return [];
      }
      return [{ url, title, excerpt }];
    } catch {
      return [];
    }
  });
}

export function getTranscriptEnrichmentStaleReason(
  enrichment: EnrichmentFreshnessInput,
  transcript: TranscriptFreshnessInput,
  now = new Date(),
): string | null {
  if (enrichment.staleReason) return enrichment.staleReason;
  if (
    enrichment.sourceVersion !== transcript.sourceVersion ||
    enrichment.sourceChecksum !== transcript.sourceChecksum
  ) {
    return 'source-version-changed';
  }
  if (enrichment.expiresAt && enrichment.expiresAt < now) return 'research-expired';
  return null;
}

export async function refreshTranscriptEnrichmentFreshness(input: {
  userId: string;
  transcriptId: string;
  sourceVersion: number;
  sourceChecksum: string | null;
  now?: Date;
}): Promise<string[]> {
  const now = input.now ?? new Date();
  await db.transcriptEnrichment.updateMany({
    where: {
      userId: input.userId,
      transcriptId: input.transcriptId,
      staleReason: null,
      OR: [
        { sourceVersion: { not: input.sourceVersion } },
        ...(input.sourceChecksum === null
          ? [{ NOT: { sourceChecksum: null } }]
          : [{ sourceChecksum: { not: input.sourceChecksum } }, { sourceChecksum: null }]),
      ],
    },
    data: { staleReason: 'source-version-changed' },
  });
  await db.transcriptEnrichment.updateMany({
    where: {
      userId: input.userId,
      transcriptId: input.transcriptId,
      staleReason: null,
      expiresAt: { lt: now },
    },
    data: { staleReason: 'research-expired' },
  });
  const acceptedStale = await db.transcriptEnrichment.findMany({
    where: {
      userId: input.userId,
      transcriptId: input.transcriptId,
      reviewState: 'ACCEPTED',
      staleReason: { not: null },
    },
    select: { id: true },
  });
  return acceptedStale.map((item) => item.id);
}

export async function cancelTranscriptEnrichmentsForInactiveParent(
  tx: Prisma.TransactionClient,
  userId: string,
  transcriptId: string,
  now: Date,
): Promise<void> {
  await tx.transcriptEnrichment.updateMany({
    where: {
      userId,
      transcriptId,
      status: { in: ['PENDING', 'RETRY', 'RUNNING'] },
    },
    data: {
      status: 'CANCELLED',
      cancelRequestedAt: now,
      startedAt: null,
      nextAttemptAt: null,
      staleReason: 'parent-inactive',
    },
  });
}

export async function queueTranscriptResearch(input: {
  userId: string;
  transcriptId: string;
  trigger: 'AUTO' | 'MANUAL' | 'MCP';
  requestId?: string;
}) {
  const mode = (await getSettingByKey('summary_research_mode').catch(() => null))?.toUpperCase();
  if (
    (input.trigger === 'AUTO' && mode !== 'AUTO') ||
    (input.trigger !== 'AUTO' && mode !== 'MANUAL' && mode !== 'AUTO')
  ) {
    throw new TranscriptResearchQueueError(
      'DISABLED',
      'A pesquisa adicional está desativada pelo administrador.',
    );
  }
  const transcript = await db.transcript.findFirst({
    where: { id: input.transcriptId, userId: input.userId, status: 'ACTIVE' },
    select: { id: true, sourceVersion: true, sourceChecksum: true },
  });
  if (!transcript) {
    throw new TranscriptResearchQueueError('NOT_FOUND', 'Transcrição não encontrada.');
  }
  const revision = await db.configRevision.findFirst({
    orderBy: { number: 'desc' },
    select: { id: true },
  });
  const requestId = input.trigger === 'AUTO' ? '' : (input.requestId ?? randomUUID());
  const runKey = createHash('sha256')
    .update(
      [
        input.trigger.toLowerCase(),
        transcript.id,
        transcript.sourceVersion,
        transcript.sourceChecksum ?? '',
        revision?.id ?? '',
        requestId,
      ].join(':'),
    )
    .digest('hex');
  return db.transcriptEnrichment.upsert({
    where: {
      userId_transcriptId_runKey: {
        userId: input.userId,
        transcriptId: transcript.id,
        runKey,
      },
    },
    update: {},
    create: {
      userId: input.userId,
      transcriptId: transcript.id,
      configRevisionId: revision?.id ?? null,
      runKey,
      trigger: input.trigger,
      sourceVersion: transcript.sourceVersion,
      sourceChecksum: transcript.sourceChecksum,
      title: '',
      content: '',
      status: 'PENDING',
      reviewState: 'SUGGESTED',
    },
  });
}
