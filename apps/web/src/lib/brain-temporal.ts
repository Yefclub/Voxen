import { Prisma } from '../../prisma-generated/client';
import { db } from './db';

export type BrainTimelineInput = {
  query?: string;
  entityRef?: string;
  asOf?: string;
  from?: string;
  to?: string;
  limit?: number;
};

type TemporalQueryClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

type BrainTimelineRow = {
  id: string;
  factKey: string;
  predicate: string;
  kind: string;
  confidence: Prisma.Decimal | number;
  method: string;
  validFrom: Date | null;
  validTo: Date | null;
  observedAt: Date;
  invalidatedAt: Date | null;
  subjectId: string;
  subjectKey: string;
  subjectLabel: string;
  subjectType: string;
  objectId: string;
  objectKey: string;
  objectLabel: string;
  objectType: string;
  sources: unknown;
};

function parseInstant(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error(`${field} must be a valid ISO-8601 date.`);
  return parsed;
}

export function normalizeEntityAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export async function queryBrainTimeline(
  userId: string,
  input: BrainTimelineInput,
  client: TemporalQueryClient = db,
) {
  const asOf = parseInstant(input.asOf, 'asOf');
  const from = parseInstant(input.from, 'from');
  const to = parseInstant(input.to, 'to');
  if (asOf && (from || to)) throw new Error('asOf cannot be combined with from/to.');
  if (from && to && to <= from) throw new Error('to must be later than from.');
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 12)));
  const query = input.query?.trim().slice(0, 300) || null;
  const entityRef = input.entityRef?.trim().slice(0, 300) || null;
  const normalizedAlias = entityRef ? normalizeEntityAlias(entityRef) : null;

  const temporalFilter = asOf
    ? Prisma.sql`AND fact."validFrom" IS NOT NULL
                 AND fact."validFrom" <= ${asOf}
                 AND (fact."validTo" IS NULL OR fact."validTo" > ${asOf})`
    : from || to
      ? Prisma.sql`AND fact."validFrom" IS NOT NULL
                   ${to ? Prisma.sql`AND fact."validFrom" < ${to}` : Prisma.empty}
                   ${from ? Prisma.sql`AND (fact."validTo" IS NULL OR fact."validTo" > ${from})` : Prisma.empty}`
      : Prisma.sql`AND fact."validTo" IS NULL
                   AND (fact."validFrom" IS NULL OR fact."validFrom" <= CURRENT_TIMESTAMP)`;

  const rows = await client.$queryRaw<BrainTimelineRow[]>(Prisma.sql`
    SELECT fact.id, fact."factKey", fact.predicate, edge.kind::text AS kind,
           fact.confidence, fact.method, fact."validFrom", fact."validTo",
           fact."observedAt", fact."invalidatedAt",
           subject.id AS "subjectId", subject.key AS "subjectKey",
           subject.label AS "subjectLabel", subject.type::text AS "subjectType",
           object.id AS "objectId", object.key AS "objectKey",
           object.label AS "objectLabel", object.type::text AS "objectType",
           JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
             'sourceType', source."sourceType"::text,
             'sourceId', source."sourceId",
             'startLine', source."startLine",
             'endLine', source."endLine",
             'startSec', source."startSec",
             'endSec', source."endSec",
             'excerpt', source.excerpt
           )) AS sources
    FROM "BrainFact" fact
    JOIN "BrainEdge" edge
      ON edge.id = fact."edgeId" AND edge."userId" = fact."userId"
    JOIN "BrainNode" subject
      ON subject.id = edge."fromNodeId" AND subject."userId" = fact."userId"
    JOIN "BrainNode" object
      ON object.id = edge."toNodeId" AND object."userId" = fact."userId"
    JOIN "BrainSource" source
      ON source."factId" = fact.id AND source."userId" = fact."userId"
    JOIN "Transcript" transcript
      ON source."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
     AND transcript.id = source."sourceId"
     AND transcript."userId" = fact."userId"
     AND transcript.status = 'ACTIVE'::"ContentStatus"
    WHERE fact."userId" = ${userId}
      AND fact."invalidatedAt" IS NULL
      AND edge.status = 'ACTIVE'::"ContentStatus"
      AND subject.status = 'ACTIVE'::"ContentStatus"
      AND object.status = 'ACTIVE'::"ContentStatus"
      ${temporalFilter}
      ${
        query
          ? Prisma.sql`AND (
              fact.predicate ILIKE ${`%${query}%`}
              OR subject.label ILIKE ${`%${query}%`}
              OR object.label ILIKE ${`%${query}%`}
            )`
          : Prisma.empty
      }
      ${
        entityRef
          ? Prisma.sql`AND (
              subject.id = ${entityRef} OR subject.key = ${entityRef}
              OR object.id = ${entityRef} OR object.key = ${entityRef}
              OR EXISTS (
                SELECT 1 FROM "BrainEntityAlias" alias
                WHERE alias."userId" = ${userId}
                  AND alias."entityNodeId" IN (subject.id, object.id)
                  AND alias."normalizedAlias" = ${normalizedAlias}
              )
            )`
          : Prisma.empty
      }
    GROUP BY fact.id, edge.kind, subject.id, object.id
    ORDER BY COALESCE(fact."validFrom", fact."observedAt") DESC, fact.id ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    factKey: row.factKey,
    predicate: row.predicate,
    kind: row.kind,
    confidence: Number(row.confidence),
    method: row.method,
    validFrom: row.validFrom?.toISOString() ?? null,
    validTo: row.validTo?.toISOString() ?? null,
    observedAt: row.observedAt.toISOString(),
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    subject: {
      id: row.subjectId,
      key: row.subjectKey,
      label: row.subjectLabel,
      type: row.subjectType,
    },
    object: {
      id: row.objectId,
      key: row.objectKey,
      label: row.objectLabel,
      type: row.objectType,
    },
    sources: Array.isArray(row.sources) ? row.sources : [],
  }));
}
