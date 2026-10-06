import { Prisma, type BrainSourceType } from '../../prisma-generated/client';
import { db } from './db';
import { getTranscriptEnrichmentStaleReason } from './transcript-enrichments';

type SourceReference = { sourceType: BrainSourceType; sourceId: string };
export type BrainSourceVisibilityDb = Pick<
  typeof db,
  'transcript' | 'note' | 'libraryFolder' | 'job' | 'conversation' | 'transcriptEnrichment'
>;

/** Evidence visibility must not depend on whether projection repair has run. */
export async function filterCurrentOwnedBrainSources<T extends SourceReference>(
  userId: string,
  sources: T[],
  includeArchived = false,
  client: BrainSourceVisibilityDb = db,
): Promise<T[]> {
  if (sources.length === 0) return [];
  const ids = (type: BrainSourceType) => [
    ...new Set(
      sources.filter((source) => source.sourceType === type).map((source) => source.sourceId),
    ),
  ];
  const current = new Set<string>();
  const retain = (type: BrainSourceType, rows: Array<{ id: string }>) => {
    for (const row of rows) current.add(`${type}:${row.id}`);
  };
  await Promise.all([
    (async () => {
      const requested = ids('TRANSCRIPT');
      if (!requested.length) return;
      retain(
        'TRANSCRIPT',
        await client.transcript.findMany({
          where: {
            userId,
            id: { in: requested },
            status: { in: includeArchived ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE'] },
          },
          select: { id: true },
        }),
      );
    })(),
    (async () => {
      const requested = ids('NOTE');
      if (!requested.length) return;
      retain(
        'NOTE',
        await client.note.findMany({
          where: { userId, id: { in: requested } },
          select: { id: true },
        }),
      );
    })(),
    (async () => {
      const requested = ids('FOLDER');
      if (!requested.length) return;
      const [notes, folders] = await Promise.all([
        client.note.findMany({
          where: { userId, id: { in: requested }, kind: 'FOLDER' },
          select: { id: true },
        }),
        client.libraryFolder.findMany({
          where: { userId, id: { in: requested } },
          select: { id: true },
        }),
      ]);
      retain('FOLDER', [...notes, ...folders]);
    })(),
    (async () => {
      const requested = ids('JOB');
      if (!requested.length) return;
      retain(
        'JOB',
        await client.job.findMany({
          where: {
            userId,
            id: { in: requested },
            status: { in: ['DONE', 'COMPLETED_WITH_WARNINGS'] },
          },
          select: { id: true },
        }),
      );
    })(),
    (async () => {
      const requested = ids('CHAT');
      if (!requested.length) return;
      retain(
        'CHAT',
        await client.conversation.findMany({
          where: {
            userId,
            id: { in: requested },
            ...(includeArchived ? {} : { archivedAt: null }),
          },
          select: { id: true },
        }),
      );
    })(),
    (async () => {
      const requested = ids('EXTERNAL_ENRICHMENT');
      if (!requested.length) return;
      const rows = await client.transcriptEnrichment.findMany({
        where: {
          userId,
          id: { in: requested },
          status: 'READY',
          reviewState: 'ACCEPTED',
          transcript: {
            userId,
            status: { in: includeArchived ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE'] },
          },
        },
        select: {
          id: true,
          staleReason: true,
          sourceVersion: true,
          sourceChecksum: true,
          expiresAt: true,
          revision: true,
          brainProjectedRevision: true,
          brainProjectionPending: true,
          transcript: { select: { sourceVersion: true, sourceChecksum: true } },
        },
      });
      retain(
        'EXTERNAL_ENRICHMENT',
        rows.filter(
          (row) =>
            !row.brainProjectionPending &&
            row.brainProjectedRevision === row.revision &&
            !getTranscriptEnrichmentStaleReason(row, row.transcript),
        ),
      );
    })(),
  ]);
  // Manual evidence has no separate parent record. Its owner is enforced by
  // the caller's scoped BrainSource query.
  return sources.filter(
    (source) =>
      source.sourceType === 'MANUAL' || current.has(`${source.sourceType}:${source.sourceId}`),
  );
}

export async function filterAccessibleBrainNodes<
  T extends {
    id: string;
    sourceType: BrainSourceType | null;
    sourceId: string | null;
    metadata?: unknown;
  },
>(
  userId: string,
  nodes: T[],
  includeArchived = false,
  client: BrainSourceVisibilityDb = db,
): Promise<T[]> {
  const references = nodes.flatMap((node) =>
    node.sourceType && node.sourceId
      ? [{ sourceType: node.sourceType, sourceId: node.sourceId }]
      : [],
  );
  const visible = new Set(
    (await filterCurrentOwnedBrainSources(userId, references, includeArchived, client)).map(
      (source) => `${source.sourceType}:${source.sourceId}`,
    ),
  );
  const enrichmentIds = nodes
    .filter((node) => node.sourceType === 'EXTERNAL_ENRICHMENT' && node.sourceId)
    .map((node) => node.sourceId!);
  const enrichmentRevisions = new Map(
    (enrichmentIds.length
      ? await client.transcriptEnrichment.findMany({
          where: { userId, id: { in: enrichmentIds } },
          select: { id: true, revision: true },
        })
      : []
    ).map((row) => [row.id, row.revision]),
  );
  const currentStamp = (node: T): boolean => {
    if (node.sourceType !== 'EXTERNAL_ENRICHMENT') return true;
    const revision = enrichmentRevisions.get(node.sourceId!);
    const metadata =
      node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {};
    return (
      metadata.enrichmentRevision === revision ||
      (revision === 1 && metadata.enrichmentRevision === undefined)
    );
  };
  return nodes.filter(
    (node) =>
      currentStamp(node) &&
      (node.sourceType === null ||
        node.sourceType === 'MANUAL' ||
        visible.has(`${node.sourceType}:${node.sourceId}`)),
  );
}

/** Alias is a closed internal identifier, never a client-supplied SQL fragment. */
export function currentBrainNodeSourceCondition(alias: 'n' | 'f' | 't'): Prisma.Sql {
  const node = Prisma.raw(alias);
  return Prisma.sql`(
    ${node}."sourceType" IS NULL OR ${node}."sourceType" = 'MANUAL'::"BrainSourceType"
    OR (${node}."sourceType" = 'TRANSCRIPT'::"BrainSourceType" AND EXISTS (
      SELECT 1 FROM "Transcript" source_transcript WHERE source_transcript.id = ${node}."sourceId"
        AND source_transcript."userId" = ${node}."userId" AND source_transcript.status = 'ACTIVE'::"ContentStatus"))
    OR (${node}."sourceType" = 'NOTE'::"BrainSourceType" AND EXISTS (
      SELECT 1 FROM "Note" source_note WHERE source_note.id = ${node}."sourceId"
        AND source_note."userId" = ${node}."userId"))
    OR (${node}."sourceType" = 'FOLDER'::"BrainSourceType" AND (
      EXISTS (SELECT 1 FROM "Note" source_note WHERE source_note.id = ${node}."sourceId"
        AND source_note."userId" = ${node}."userId" AND source_note.kind = 'FOLDER')
      OR EXISTS (SELECT 1 FROM "LibraryFolder" source_folder WHERE source_folder.id = ${node}."sourceId"
        AND source_folder."userId" = ${node}."userId")))
    OR (${node}."sourceType" = 'JOB'::"BrainSourceType" AND EXISTS (
      SELECT 1 FROM "Job" source_job WHERE source_job.id = ${node}."sourceId"
        AND source_job."userId" = ${node}."userId" AND source_job.status IN ('DONE', 'COMPLETED_WITH_WARNINGS')))
    OR (${node}."sourceType" = 'CHAT'::"BrainSourceType" AND EXISTS (
      SELECT 1 FROM "Conversation" source_chat WHERE source_chat.id = ${node}."sourceId"
        AND source_chat."userId" = ${node}."userId" AND source_chat."archivedAt" IS NULL))
    OR (${node}."sourceType" = 'EXTERNAL_ENRICHMENT'::"BrainSourceType" AND EXISTS (
      SELECT 1 FROM "TranscriptEnrichment" source_enrichment
      JOIN "Transcript" source_transcript ON source_transcript.id = source_enrichment."transcriptId"
        AND source_transcript."userId" = source_enrichment."userId"
      WHERE source_enrichment.id = ${node}."sourceId" AND source_enrichment."userId" = ${node}."userId"
        AND NOT source_enrichment."brainProjectionPending"
        AND source_enrichment."brainProjectedRevision" = source_enrichment.revision
        AND ((${node}.metadata -> 'enrichmentRevision') = to_jsonb(source_enrichment.revision)
          OR (source_enrichment.revision = 1 AND NOT (${node}.metadata ? 'enrichmentRevision')))
        AND source_transcript.status = 'ACTIVE'::"ContentStatus"
        AND source_enrichment.status = 'READY' AND source_enrichment."reviewState" = 'ACCEPTED'
        AND source_enrichment."staleReason" IS NULL
        AND (source_enrichment."expiresAt" IS NULL OR source_enrichment."expiresAt" >= CURRENT_TIMESTAMP)
        AND source_enrichment."sourceVersion" = source_transcript."sourceVersion"
        AND source_enrichment."sourceChecksum" IS NOT DISTINCT FROM source_transcript."sourceChecksum"))
  )`;
}
