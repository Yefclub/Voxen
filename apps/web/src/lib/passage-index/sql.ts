import { Prisma } from '../../../prisma-generated/client';

export type PassageScope = { sourceTypes?: string[]; sourceIds?: string[] };

/** Visibility is evaluated from canonical records before ranking or LIMIT. */
export function visiblePassageSources(userId: string, scope: PassageScope = {}) {
  const types = scope.sourceTypes?.length
    ? Prisma.sql`AND v."sourceType" = ANY(${scope.sourceTypes}::text[])`
    : Prisma.empty;
  const ids = scope.sourceIds?.length
    ? Prisma.sql`AND v."sourceId" = ANY(${scope.sourceIds}::text[])`
    : Prisma.empty;
  return Prisma.sql`
    SELECT v.* FROM (
      SELECT t."userId", 'transcript'::text AS "sourceType", t.id AS "sourceId", t.title,
        '/transcricoes/' || t.id AS href
      FROM "Transcript" t JOIN "User" u ON u.id = t."userId" AND u.status = 'APPROVED'
      WHERE t."userId" = ${userId} AND t.status = 'ACTIVE'
      UNION ALL
      SELECT n."userId", 'note', n.id, n.title, '/notas/' || n.id
      FROM "Note" n JOIN "User" u ON u.id = n."userId" AND u.status = 'APPROVED'
      WHERE n."userId" = ${userId} AND n.kind = 'NOTE'
      UNION ALL
      SELECT e."userId", 'external_enrichment', e.id, e.title,
        '/transcricoes/' || t.id || '#additional-context-' || e.id
      FROM "TranscriptEnrichment" e
      JOIN "User" u ON u.id = e."userId" AND u.status = 'APPROVED'
      JOIN "Transcript" t ON t.id = e."transcriptId" AND t."userId" = e."userId"
      WHERE e."userId" = ${userId} AND t.status = 'ACTIVE' AND e.status = 'READY'
        AND e."reviewState" = 'ACCEPTED' AND e."staleReason" IS NULL
        AND (e."expiresAt" IS NULL OR e."expiresAt" > CURRENT_TIMESTAMP)
        AND e."sourceVersion" = t."sourceVersion"
        AND e."sourceChecksum" IS NOT DISTINCT FROM t."sourceChecksum"
    ) v WHERE TRUE ${types} ${ids}
  `;
}

export function passageQuery(query: string) {
  return Prisma.sql`(websearch_to_tsquery('pg_catalog.simple', ${query})
    || websearch_to_tsquery('pg_catalog.portuguese', ${query})
    || websearch_to_tsquery('pg_catalog.english', ${query}))`;
}

export const passageLiteral = (query: string) => `%${query.replace(/[\\%_]/g, '\\$&')}%`;
export const exactIdentifier = (query: string) =>
  /^[\p{L}\p{N}._:#/+@-]+$/u.test(query) && /[.+#_:/@-]/.test(query);
