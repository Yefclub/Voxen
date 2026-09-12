import { BRAIN_INDEX_VERSION } from './brain';
import { db } from './db';
import type { GraphIndexCoverage } from '../shared/graph-index';

export interface BrainCoverage {
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
  semantic: GraphIndexCoverage['semantic'];
}

export async function readBrainCoverage(userId: string): Promise<BrainCoverage> {
  const [transcripts, notes, folders, enrichments, brainNodes, staleSourceNodes, semantic] =
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
      readSemanticCoverage(userId),
    ]);
  return {
    expectedSourceNodes: transcripts + notes + folders + enrichments,
    indexedSourceNodes: brainNodes,
    staleSourceNodes,
    semantic,
  };
}

async function readSemanticCoverage(userId: string): Promise<GraphIndexCoverage['semantic']> {
  const rows = await db.$queryRaw<
    Array<{
      total: number | bigint;
      pending: number | bigint;
      running: number | bigint;
      retrying: number | bigint;
      completed: number | bigint;
      failed: number | bigint;
      skipped: number | bigint;
    }>
  >`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE segment.status::text = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE segment.status::text = 'RUNNING')::int AS running,
      count(*) FILTER (WHERE segment.status::text = 'RETRY')::int AS retrying,
      count(*) FILTER (WHERE segment.status::text = 'COMPLETED')::int AS completed,
      count(*) FILTER (WHERE segment.status::text = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE segment.status::text = 'SKIPPED')::int AS skipped
    FROM "BrainCompilationSegment" segment
    JOIN "BrainCompilation" compilation
      ON compilation.id = segment."compilationId"
     AND compilation."userId" = ${userId}
    JOIN "Transcript" transcript
      ON transcript.id = compilation."transcriptId"
     AND transcript."userId" = compilation."userId"
     AND transcript.status = 'ACTIVE'::"ContentStatus"
  `;
  const row = rows[0];
  return {
    total: numeric(row?.total),
    pending: numeric(row?.pending),
    running: numeric(row?.running),
    retrying: numeric(row?.retrying),
    completed: numeric(row?.completed),
    failed: numeric(row?.failed),
    skipped: numeric(row?.skipped),
  };
}

function numeric(value: number | bigint | undefined): number {
  if (value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
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
