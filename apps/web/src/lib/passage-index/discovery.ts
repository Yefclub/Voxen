import { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { currentBrainNodeSourceCondition } from '../brain-source-visibility';
import { structuredDiagnostic } from '../structured-log';
import { visiblePassageSources, type PassageScope } from './sql';

export type KnowledgeName = {
  kind: 'document' | 'entity';
  id: string;
  sourceType: 'transcript' | 'note' | 'external_enrichment' | null;
  name: string;
  href: string;
  score: number;
  verified: false;
};

/** Discovery only: never a quote verification or an identity-merge decision. */
export async function discoverKnowledgeNames(
  userId: string,
  query: string,
  scope: PassageScope = {},
  limit = 5,
) {
  const words = query.trim().split(/\s+/);
  if (
    !/^[\p{L}\p{N} ]{4,100}$/u.test(query) ||
    !/\p{L}/u.test(query) ||
    words.length > 4 ||
    words.some((word) => word.length < 3)
  )
    return { matches: [] as KnowledgeName[], unavailable: false };
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('INVALID_LIMIT');
  const q = query.toLowerCase();
  const entities =
    scope.sourceIds || scope.sourceTypes
      ? Prisma.empty
      : Prisma.sql`
    UNION ALL
    SELECT 'entity', n.id, NULL::text, n.label, '/grafo',
      strict_word_similarity(${q}, lower(n.label))
    FROM "BrainNode" n JOIN "User" u ON u.id = n."userId" AND u.status = 'APPROVED'
    WHERE n."userId" = ${userId} AND n.status = 'ACTIVE' AND n.type IN ('ENTITY', 'TOPIC')
      AND ${currentBrainNodeSourceCondition('n')}
      AND lower(n.label) %>> ${q}
  `;
  try {
    const matches = await db.$transaction(async (tx) => {
      // Local settings cannot leak into another request through the connection pool.
      await tx.$executeRawUnsafe("SET LOCAL pg_trgm.strict_word_similarity_threshold = '0.4'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1500ms'");
      return tx.$queryRaw<Array<Omit<KnowledgeName, 'verified'>>>(Prisma.sql`
        WITH visible AS (${visiblePassageSources(userId, scope)}), names AS (
          SELECT 'document'::text AS kind, v."sourceId" AS id, v."sourceType", v.title AS name, v.href,
            strict_word_similarity(${q}, lower(s.title)) AS score
          FROM visible v JOIN "PassageIndexSource" s
            ON s."userId" = v."userId" AND s."sourceType" = v."sourceType" AND s."sourceId" = v."sourceId"
            AND s.status = 'READY' AND s."indexedGeneration" = s.generation
          WHERE lower(s.title) %>> ${q}
          ${entities}
        ) SELECT kind, id, "sourceType", left(name, 200) AS name, href, score FROM names
          ORDER BY score DESC, kind, "sourceType", id LIMIT ${limit}
      `);
    });
    return {
      matches: matches.map((row) => ({ ...row, verified: false as const })),
      unavailable: false,
    };
  } catch (error) {
    structuredDiagnostic(
      'warning',
      'passage-discovery-unavailable',
      'PASSAGE_DISCOVERY_UNAVAILABLE',
      error,
    );
    return { matches: [] as KnowledgeName[], unavailable: true };
  }
}
