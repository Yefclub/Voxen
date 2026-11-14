import { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { structuredDiagnostic } from '../structured-log';
import { buildPassages, PassageBuildError } from './build';
import { loadPassageSource, PassageSourceError, type PassageIdentity } from './source';
import { claimPassageIndex, failPassageIndex, publishPassageIndex } from './store';

export async function executePassageIndex(
  identity: PassageIdentity,
  load = loadPassageSource,
): Promise<boolean> {
  const claim = await claimPassageIndex(identity);
  if (!claim) return false;
  try {
    const loaded = await load(identity),
      built = buildPassages(loaded.source);
    const published = await publishPassageIndex(claim, loaded, built);
    if (!published) await failPassageIndex(claim, 'STALE_REVISION', true);
    return published;
  } catch (error) {
    const known = error instanceof PassageBuildError || error instanceof PassageSourceError;
    const code = known ? error.code : 'INDEX_FAILED';
    await failPassageIndex(claim, code, !(error instanceof PassageBuildError));
    if (!known) structuredDiagnostic('warning', 'passage-index-failed', 'INDEX_FAILED', error);
    return false;
  }
}

/** Bounded conflict-safe discovery: accepted rows survive process restarts. */
export async function backfillPassageSources(userId?: string, limit = 50): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_LIMIT');
  const owner = (alias: string) =>
    userId ? Prisma.sql`AND ${Prisma.raw(alias)}."userId" = ${userId}` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ sourceId: string }>>(Prisma.sql`
    INSERT INTO "PassageIndexSource" ("userId", "sourceType", "sourceId")
    SELECT c."userId", c."sourceType", c.id FROM (
      SELECT t."userId", 'transcript' AS "sourceType", t.id FROM "Transcript" t
        JOIN "User" u ON u.id = t."userId" AND u.status = 'APPROVED'
        WHERE t.status = 'ACTIVE' ${owner('t')}
      UNION ALL
      SELECT n."userId", 'note', n.id FROM "Note" n
        JOIN "User" u ON u.id = n."userId" AND u.status = 'APPROVED'
        WHERE n.kind = 'NOTE' ${owner('n')}
      UNION ALL
      SELECT e."userId", 'external_enrichment', e.id FROM "TranscriptEnrichment" e
        JOIN "User" u ON u.id = e."userId" AND u.status = 'APPROVED'
        JOIN "Transcript" t ON t.id = e."transcriptId" AND t."userId" = e."userId"
        WHERE t.status = 'ACTIVE' AND e.status = 'READY' AND e."reviewState" = 'ACCEPTED'
          AND e."staleReason" IS NULL AND (e."expiresAt" IS NULL OR e."expiresAt" > CURRENT_TIMESTAMP)
          AND e."sourceVersion" = t."sourceVersion" AND e."sourceChecksum" IS NOT DISTINCT FROM t."sourceChecksum" ${owner('e')}
    ) c WHERE NOT EXISTS (
      SELECT 1 FROM "PassageIndexSource" s WHERE s."userId" = c."userId"
        AND s."sourceType" = c."sourceType" AND s."sourceId" = c.id
    ) ORDER BY c."sourceType", c.id LIMIT ${limit}
    ON CONFLICT DO NOTHING RETURNING "sourceId"
  `);
  return rows.length;
}
