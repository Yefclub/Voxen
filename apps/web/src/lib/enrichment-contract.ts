import { createHash } from 'node:crypto';
import type { TranscriptEnrichment } from '../../prisma-generated/client';
import {
  getTranscriptEnrichmentStaleReason,
  normalizeTranscriptEnrichmentCitations,
} from './transcript-enrichments';

export type EnrichmentParent = {
  sourceVersion: number;
  sourceChecksum: string | null;
  status: string;
};
export function enrichmentChecksum(row: TranscriptEnrichment, parent: EnrichmentParent): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: row.id,
        userId: row.userId,
        transcriptId: row.transcriptId,
        revision: row.revision,
        title: row.title,
        content: row.content,
        citations: normalizeTranscriptEnrichmentCitations(row.citations),
        status: row.status,
        reviewState: row.reviewState,
        sourceVersion: row.sourceVersion,
        sourceChecksum: row.sourceChecksum,
        staleReason: getTranscriptEnrichmentStaleReason(row, parent),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
        parent: {
          sourceVersion: parent.sourceVersion,
          sourceChecksum: parent.sourceChecksum,
          status: parent.status,
        },
      }),
    )
    .digest('hex');
}

export function enrichmentContract(row: TranscriptEnrichment, parent: EnrichmentParent) {
  return {
    revision: row.revision,
    checksum: enrichmentChecksum(row, parent),
    projection: {
      state:
        row.brainProjectionPending || row.brainProjectedRevision !== row.revision
          ? ('PENDING' as const)
          : ('SYNCED' as const),
      revision: row.revision,
      appliedRevision: row.brainProjectedRevision,
      errorCode: row.brainProjectionErrorCode,
    },
  };
}
