import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OrganizationRun, Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { storageReadText } from '../storage';
import { sourceEvidenceStamp } from '../source-provenance';
import { unconfirmedOrganizationUsage } from './usage';
import {
  ACTIVE_ORGANIZATION_STATUSES,
  getOrganizationPreferences,
  lockOrganizationUser,
  readOrganizationPreferences,
} from './preferences';
import {
  OrganizationError,
  organizationHash,
  organizationSections,
  organizationSnapshot,
  type OrganizationSource,
} from './source';

export const ORGANIZATION_SOURCE_SELECT = {
  id: true,
  userId: true,
  title: true,
  mdPath: true,
  plainText: true,
  sourceVersion: true,
  sourceChecksum: true,
  sourceMetadata: true,
  sourceCollectedAt: true,
  correctionRevision: true,
  correctionState: true,
  correctedChecksum: true,
  correctedMarkdown: true,
} as const satisfies Prisma.TranscriptSelect;
export type OrganizationSourceRecord = Prisma.TranscriptGetPayload<{
  select: typeof ORGANIZATION_SOURCE_SELECT;
}>;
export const organizationRecordChecksum = (record: OrganizationSourceRecord) =>
  organizationHash(JSON.stringify(record));

export const OrganizationSettingsSchema = z.object({
  executorVersion: z.literal(1),
  role: z.literal('standard'),
  mode: z.enum(['MANUAL', 'AUTO']),
  automaticSince: z.string().datetime().nullable(),
  recordChecksum: z.string().length(64),
  snapshot: z.object({
    title: z.string(),
    sourceVersion: z.number().int().nonnegative(),
    sourceChecksum: z.string().nullable(),
    correctionRevision: z.number().int().nonnegative(),
    correctionState: z.enum(['ACTIVE', 'STALE']),
    correctedChecksum: z.string().nullable(),
    bodyChecksum: z.string().length(64),
    canonicalChecksum: z.string().length(64),
    capturedSource: z.boolean(),
    manifestChecksum: z.string().length(64).nullable(),
  }),
});
export function matchesOrganizationRecord(settings: unknown, record: OrganizationSourceRecord) {
  const parsed = OrganizationSettingsSchema.safeParse(settings);
  return parsed.success && parsed.data.recordChecksum === organizationRecordChecksum(record);
}
export async function lockOrganizationSource(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT source.id FROM "Transcript" source JOIN "User" owner ON owner.id = source."userId"
    WHERE source.id = ${id} AND source."userId" = ${userId}
      AND source.status = 'ACTIVE' AND owner.status = 'APPROVED'
    FOR UPDATE OF source
  `;
  if (!rows.length) throw new OrganizationError('NOT_FOUND');
  return tx.transcript.findFirstOrThrow({
    where: { id, userId },
    select: ORGANIZATION_SOURCE_SELECT,
  });
}

/** Read objects outside database transactions; publication rechecks the frozen head. */
export async function loadOrganizationSource(userId: string, id: string) {
  const record = await db.transcript.findFirst({
    where: { id, userId, status: 'ACTIVE', user: { status: 'APPROVED' } },
    select: ORGANIZATION_SOURCE_SELECT,
  });
  if (!record) throw new OrganizationError('NOT_FOUND');
  let canonicalMarkdown: string;
  try {
    canonicalMarkdown = await storageReadText(record.mdPath);
  } catch {
    throw new OrganizationError('UNAVAILABLE_SOURCE');
  }
  const source: OrganizationSource = {
    ...record,
    canonicalMarkdown,
    markdown:
      record.correctionState === 'ACTIVE' && record.correctedMarkdown !== null
        ? record.correctedMarkdown
        : canonicalMarkdown,
  };
  return { record, source };
}

export async function enqueueOrganization(
  userId: string,
  transcriptId: string,
  trigger: 'AUTO' | 'MANUAL',
  requestKey: string = randomUUID(),
) {
  if (trigger === 'MANUAL') z.string().uuid().parse(requestKey);
  const policy = await getOrganizationPreferences(userId);
  if (trigger === 'AUTO' && policy.mode !== 'AUTO') return null;
  if (policy.mode === 'OFF') throw new OrganizationError('DISABLED');
  if (trigger === 'AUTO') {
    if (!policy.automaticSince) return null;
    const eligible = await db.transcript.findFirst({
      where: {
        id: transcriptId,
        userId,
        status: 'ACTIVE',
        user: { status: 'APPROVED' },
        sourceCollectedAt: { gte: new Date(policy.automaticSince) },
        sourceMetadata: { path: ['producer'], equals: 'voxen-capture' },
      },
      select: { id: true },
    });
    if (!eligible) return null;
  }
  const loaded = await loadOrganizationSource(userId, transcriptId);
  const sections = organizationSections(loaded.source);
  const checksum = organizationRecordChecksum(loaded.record);
  return db.$transaction(async (tx) => {
    await lockOrganizationUser(tx, userId);
    const currentPolicy = await readOrganizationPreferences(tx, userId);
    if (trigger === 'AUTO' && currentPolicy.mode !== 'AUTO') return null;
    if (currentPolicy.mode === 'OFF') throw new OrganizationError('DISABLED');
    const record = await lockOrganizationSource(tx, userId, transcriptId);
    if (organizationRecordChecksum(record) !== checksum)
      throw new OrganizationError('STALE_SOURCE');
    if (
      trigger === 'AUTO' &&
      (!currentPolicy.automaticSince ||
        !record.sourceCollectedAt ||
        record.sourceCollectedAt < new Date(currentPolicy.automaticSince) ||
        !sourceEvidenceStamp(record.sourceMetadata).captured)
    )
      return null;
    const settings = {
      executorVersion: 1,
      role: 'standard',
      mode: currentPolicy.mode,
      automaticSince: currentPolicy.automaticSince,
      recordChecksum: checksum,
      snapshot: organizationSnapshot(loaded.source),
    };
    const runKey =
      trigger === 'MANUAL'
        ? `manual:${requestKey}`
        : `auto:${organizationHash(JSON.stringify(settings))}`;
    const previous = await tx.organizationRequest.findFirst({
      where: { userId, transcriptId, key: runKey, run: { userId, transcriptId } },
      include: { run: true },
    });
    if (previous) return previous.run;
    const accept = async (run: OrganizationRun) => {
      await tx.organizationRequest.create({
        data: { userId, transcriptId, key: runKey, runId: run.id },
      });
      return run;
    };
    const active = await tx.organizationRun.findFirst({
      where: { userId, transcriptId, status: { in: [...ACTIVE_ORGANIZATION_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active && matchesOrganizationRecord(active.generationSettings, record))
      return accept(active);
    if (active)
      await tx.organizationRun.updateMany({
        where: { userId, transcriptId, status: { in: [...ACTIVE_ORGANIZATION_STATUSES] } },
        data: {
          ...(await unconfirmedOrganizationUsage(tx, userId, active.id)),
          status: 'CANCELLED',
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: 'SOURCE_CHANGED',
          revision: { increment: 1 },
        },
      });
    return accept(
      await tx.organizationRun.create({
        data: {
          userId,
          transcriptId,
          runKey,
          trigger,
          generationSettings: settings,
          totalSections: sections.length,
          sections: {
            create: sections.map((section, ordinal) => ({
              sectionKey: section.key,
              ordinal,
              startLine: section.startLine,
              endLine: section.endLine,
            })),
          },
        },
      }),
    );
  });
}
