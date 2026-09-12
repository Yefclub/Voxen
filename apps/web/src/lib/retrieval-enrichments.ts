import { db } from './db';
import type { KnowledgeSearchResult } from './retrieval';

export async function ftsSearchTranscriptEnrichments(
  userId: string,
  query: string,
  limit: number,
): Promise<KnowledgeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const take = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(limit) ? limit : 8)));
  type EnrichmentRow = {
    id: string;
    transcriptId: string;
    title: string;
    snippet: string;
    rank: number;
    createdAt: Date;
  };
  const rows = await db.$queryRaw<EnrichmentRow[]>`
    SELECT e.id, e."transcriptId", e.title,
      ts_headline('portuguese', concat_ws(E'\n\n', e.title, e.content),
        websearch_to_tsquery('portuguese', ${q}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
      ts_rank(to_tsvector('portuguese', concat_ws(E'\n\n', e.title, e.content)),
        websearch_to_tsquery('portuguese', ${q})) * 0.85 AS rank,
      e."createdAt"
    FROM "TranscriptEnrichment" e
    JOIN "Transcript" t ON t.id = e."transcriptId" AND t."userId" = e."userId"
    WHERE e."userId" = ${userId}
      AND e.status = 'READY'::"TranscriptEnrichmentStatus"
      AND e."reviewState" = 'ACCEPTED'::"TranscriptEnrichmentReviewState"
      AND e."staleReason" IS NULL
      AND (e."expiresAt" IS NULL OR e."expiresAt" >= NOW())
      AND t.status = 'ACTIVE'::"ContentStatus"
      AND to_tsvector('portuguese', concat_ws(E'\n\n', e.title, e.content))
          @@ websearch_to_tsquery('portuguese', ${q})
    ORDER BY rank DESC, e."updatedAt" DESC
    LIMIT ${take}
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    rank: Number(row.rank),
    createdAt: row.createdAt,
    sourceType: 'external_enrichment',
    href: `/transcricoes/${row.transcriptId}#additional-context-${row.id}`,
    summary: null,
    tags: [],
    folder: null,
  }));
}
