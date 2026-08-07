import { BRAIN_INDEX_VERSION } from './brain';
import { db } from './db';

export interface BrainCoverage {
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
}

export async function readBrainCoverage(userId: string): Promise<BrainCoverage> {
  const [transcripts, notes, folders, enrichments, brainNodes, staleSourceNodes] =
    await Promise.all([
      db.transcript.count({ where: { userId, status: 'ACTIVE' } }),
      db.note.count({ where: { userId } }),
      db.libraryFolder.count({ where: { userId } }),
      db.transcriptEnrichment.count({
        where: {
          userId,
          status: 'READY',
          reviewState: 'ACCEPTED',
          staleReason: null,
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
          transcript: { status: 'ACTIVE' },
        },
      }),
      db.brainNode.count({
        where: {
          userId,
          status: 'ACTIVE',
          sourceType: { in: ['TRANSCRIPT', 'NOTE', 'FOLDER', 'EXTERNAL_ENRICHMENT'] },
        },
      }),
      countStaleBrainSourceNodes(userId),
    ]);
  return {
    expectedSourceNodes: transcripts + notes + folders + enrichments,
    indexedSourceNodes: brainNodes,
    staleSourceNodes,
  };
}

async function countStaleBrainSourceNodes(userId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT count(*)::int AS count
    FROM "BrainNode" n
    LEFT JOIN "Transcript" t
      ON n."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
     AND t.id = n."sourceId"
     AND t."userId" = n."userId"
    LEFT JOIN "Note" note
      ON n."sourceType" = 'NOTE'::"BrainSourceType"
     AND note.id = n."sourceId"
     AND note."userId" = n."userId"
    LEFT JOIN "LibraryFolder" folder
      ON n."sourceType" = 'FOLDER'::"BrainSourceType"
     AND folder.id = n."sourceId"
     AND folder."userId" = n."userId"
    LEFT JOIN "TranscriptEnrichment" enrichment
      ON n."sourceType" = 'EXTERNAL_ENRICHMENT'::"BrainSourceType"
     AND enrichment.id = n."sourceId"
     AND enrichment."userId" = n."userId"
    LEFT JOIN "Transcript" enrichment_parent
      ON enrichment_parent.id = enrichment."transcriptId"
     AND enrichment_parent."userId" = enrichment."userId"
    WHERE n."userId" = ${userId}
      AND n."sourceType"::text IN ('TRANSCRIPT', 'NOTE', 'FOLDER', 'EXTERNAL_ENRICHMENT')
      AND (
        (n."sourceType" = 'TRANSCRIPT'::"BrainSourceType" AND t.id IS NULL)
        OR (n."sourceType" = 'NOTE'::"BrainSourceType" AND note.id IS NULL)
        OR (n."sourceType" = 'FOLDER'::"BrainSourceType" AND folder.id IS NULL)
        OR (
          n."sourceType" = 'EXTERNAL_ENRICHMENT'::"BrainSourceType"
          AND (
            enrichment.id IS NULL
            OR enrichment_parent.id IS NULL
            OR enrichment_parent.status <> 'ACTIVE'::"ContentStatus"
            OR enrichment.status <> 'READY'::"TranscriptEnrichmentStatus"
            OR enrichment."reviewState" <> 'ACCEPTED'::"TranscriptEnrichmentReviewState"
            OR enrichment."staleReason" IS NOT NULL
            OR (enrichment."expiresAt" IS NOT NULL AND enrichment."expiresAt" < NOW())
          )
        )
        OR (
          n.status = 'ACTIVE'::"ContentStatus"
          AND (
            coalesce(n.metadata->>'brainIndexVersion', '0') <> ${String(BRAIN_INDEX_VERSION)}
            OR (
              n."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(t."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
            OR (
              n."sourceType" = 'NOTE'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(note."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
            OR (
              n."sourceType" = 'FOLDER'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(folder."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
            OR (
              n."sourceType" = 'EXTERNAL_ENRICHMENT'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(enrichment."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
          )
        )
      )
  `;
  const count = rows[0]?.count ?? 0;
  return typeof count === 'bigint' ? Number(count) : count;
}
