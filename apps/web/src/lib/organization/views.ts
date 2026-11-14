import { z } from 'zod';
import type { OrganizationRun, Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import {
  ACTIVE_ORGANIZATION_STATUSES,
  lockOrganizationUser,
  readOrganizationPreferences,
} from './preferences';
import { OrganizationError } from './source';
import { unconfirmedOrganizationUsage } from './usage';

export const OrganizationCancelSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
function serialize(row: OrganizationRun) {
  return {
    id: row.id,
    revision: row.revision,
    trigger: row.trigger,
    status: row.status,
    totalSections: row.totalSections,
    completedSections: row.completedSections,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    model: row.model,
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter(
          (value): value is string => typeof value === 'string' && /^[A-Z_]{1,100}$/.test(value),
        )
      : [],
    lastError: row.lastError && /^[A-Z_]{1,100}$/.test(row.lastError) ? row.lastError : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
async function lockParent(tx: Prisma.TransactionClient, userId: string, transcriptId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT source.status FROM "Transcript" source JOIN "User" owner ON owner.id = source."userId"
    WHERE source.id = ${transcriptId} AND source."userId" = ${userId}
      AND source.status IN ('ACTIVE', 'ARCHIVED') AND owner.status = 'APPROVED'
    FOR UPDATE OF source
  `;
  if (!rows.length) throw new OrganizationError('NOT_FOUND');
  return rows[0]!.status === 'ACTIVE';
}

export function listOrganization(userId: string, transcriptId: string, cursor?: string) {
  return db.$transaction(async (tx) => {
    await lockOrganizationUser(tx, userId);
    const sourceActive = await lockParent(tx, userId, transcriptId);
    const boundary = cursor
      ? await tx.organizationRun.findFirst({
          where: { id: cursor, userId, transcriptId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (cursor && !boundary) throw new OrganizationError('NOT_FOUND');
    const rows = await tx.organizationRun.findMany({
      where: {
        userId,
        transcriptId,
        ...(boundary
          ? {
              OR: [
                { createdAt: { lt: boundary.createdAt } },
                { createdAt: boundary.createdAt, id: { lt: boundary.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 11,
    });
    const items = rows.slice(0, 10);
    return {
      items: items.map(serialize),
      sourceActive,
      mode: (await readOrganizationPreferences(tx, userId)).mode,
      nextCursor: rows.length > 10 ? items.at(-1)!.id : null,
    };
  });
}
export function readOrganization(userId: string, transcriptId: string, id: string) {
  return db.$transaction(async (tx) => {
    await lockOrganizationUser(tx, userId);
    await lockParent(tx, userId, transcriptId);
    const row = await tx.organizationRun.findFirst({ where: { id, userId, transcriptId } });
    if (!row) throw new OrganizationError('NOT_FOUND');
    return serialize(row);
  });
}
export function cancelOrganization(
  userId: string,
  transcriptId: string,
  id: string,
  input: z.infer<typeof OrganizationCancelSchema>,
) {
  const { expectedRevision } = OrganizationCancelSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockOrganizationUser(tx, userId);
    await lockParent(tx, userId, transcriptId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "OrganizationRun" WHERE id = ${id} AND "userId" = ${userId}
        AND "transcriptId" = ${transcriptId} FOR UPDATE
    `;
    if (!locked.length) throw new OrganizationError('NOT_FOUND');
    const row = await tx.organizationRun.findFirstOrThrow({ where: { id, userId, transcriptId } });
    if (!ACTIVE_ORGANIZATION_STATUSES.some((status) => status === row.status))
      return serialize(row);
    if (row.revision !== expectedRevision) throw new OrganizationError('STALE_REVISION');
    const updated = await tx.organizationRun.update({
      where: { id, userId, transcriptId, revision: expectedRevision },
      data: {
        ...(await unconfirmedOrganizationUsage(tx, userId, id)),
        status: 'CANCELLED',
        cancelRequestedAt: new Date(),
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: 'CANCELLED',
        revision: { increment: 1 },
      },
    });
    return serialize(updated);
  });
}
