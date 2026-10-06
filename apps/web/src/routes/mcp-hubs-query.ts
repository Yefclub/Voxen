import { Prisma } from '../../prisma-generated/client';
import { currentBrainNodeSourceCondition } from '../lib/brain-source-visibility';
export function mcpHubsQuery(userId: string, limit: number): Prisma.Sql {
  return Prisma.sql`
        WITH eligible_edges AS MATERIALIZED (
          SELECT e."fromNodeId", e."toNodeId"
          FROM "BrainEdge" e
          -- Keep identity lookups indexed even when a newly inserted owner lacks statistics.
          JOIN LATERAL (
            SELECT id, "userId", status, "sourceType", "sourceId" FROM "BrainNode"
            WHERE id = e."fromNodeId" OFFSET 0
          ) f ON f."userId" = e."userId"
          JOIN LATERAL (
            SELECT id, "userId", status, "sourceType", "sourceId" FROM "BrainNode"
            WHERE id = e."toNodeId" OFFSET 0
          ) t ON t."userId" = e."userId"
          WHERE e."userId" = ${userId} AND e.status = 'ACTIVE'::"ContentStatus"
            AND f.status = 'ACTIVE'::"ContentStatus" AND t.status = 'ACTIVE'::"ContentStatus"
            AND ${currentBrainNodeSourceCondition('f')}
            AND ${currentBrainNodeSourceCondition('t')}
        ), endpoints AS (
          SELECT "fromNodeId" AS id FROM eligible_edges
          UNION ALL
          SELECT "toNodeId" AS id FROM eligible_edges WHERE "toNodeId" <> "fromNodeId"
        ), degrees AS (
          SELECT id, COUNT(*)::int AS degree FROM endpoints GROUP BY id
        )
        SELECT n.id, n.key, n.label, n.type::text AS type, d.degree
        FROM degrees d JOIN "BrainNode" n ON n.id = d.id
        ORDER BY d.degree DESC, n.id ASC
        LIMIT ${limit}
  `;
}
