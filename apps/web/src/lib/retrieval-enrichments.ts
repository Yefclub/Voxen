import { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import type { KnowledgeSearchResult } from './retrieval';
import { assertTranscriptSearchFilters, type TranscriptSearchFilters } from './search-filters';

export async function ftsSearchTranscriptEnrichments(
  userId: string,
  query: string,
  limit: number,
  filters: Pick<
    TranscriptSearchFilters,
    | 'sources'
    | 'language'
    | 'publishedAfter'
    | 'publishedBefore'
    | 'createdAfter'
    | 'createdBefore'
    | 'tags'
    | 'folderId'
    | 'transcriptIds'
    | 'includeArchived'
  > = {},
): Promise<KnowledgeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const take = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(limit) ? limit : 8)));
  assertTranscriptSearchFilters(filters);
  const tconds: Prisma.Sql[] = [];
  if (filters.sources?.length) {
    tconds.push(Prisma.sql`t.source = ANY(${[...filters.sources]}::"TranscriptSource"[])`);
  }
  if (filters.language) {
    tconds.push(Prisma.sql`t.language = ${filters.language.toLowerCase()}`);
  }
  if (filters.publishedAfter) tconds.push(Prisma.sql`t."publishedAt" >= ${filters.publishedAfter}`);
  if (filters.publishedBefore)
    tconds.push(Prisma.sql`t."publishedAt" < ${filters.publishedBefore}`);
  if (filters.createdAfter) tconds.push(Prisma.sql`t."createdAt" >= ${filters.createdAfter}`);
  if (filters.createdBefore) tconds.push(Prisma.sql`t."createdAt" < ${filters.createdBefore}`);
  if (filters.folderId) tconds.push(Prisma.sql`t."folderId" = ${filters.folderId}`);
  if (filters.transcriptIds?.length) {
    tconds.push(Prisma.sql`e."transcriptId" = ANY(${[...filters.transcriptIds]}::text[])`);
  }
  if (filters.tags?.length) {
    const names = [...new Set(filters.tags.map((tag) => tag.trim().toLowerCase()))];
    tconds.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "TranscriptTag" tt
        JOIN "Tag" tag ON tag.id = tt."tagId" AND tag."userId" = t."userId"
        WHERE tt."transcriptId" = t.id
          AND (tag.slug = ANY(${names}::text[]) OR LOWER(tag.name) = ANY(${names}::text[]))
      )
    `);
  }
  const statusClause = filters.includeArchived
    ? Prisma.sql`t.status IN ('ACTIVE'::"ContentStatus", 'ARCHIVED'::"ContentStatus")`
    : Prisma.sql`t.status = 'ACTIVE'::"ContentStatus"`;
  const extra = tconds.length > 0 ? Prisma.sql`AND ${Prisma.join(tconds, ' AND ')}` : Prisma.empty;
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
      AND ${statusClause}
      AND e."sourceVersion" = t."sourceVersion"
      AND e."sourceChecksum" IS NOT DISTINCT FROM t."sourceChecksum"
      AND to_tsvector('portuguese', concat_ws(E'\n\n', e.title, e.content))
          @@ websearch_to_tsquery('portuguese', ${q})
      ${extra}
    ORDER BY rank DESC, e.id ASC
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
