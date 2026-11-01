import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';

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
      cancelRequestedAt: now,
      staleReason: 'parent-inactive',
    },
  });
}
