import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { OrganizationError } from './source';
import { unconfirmedOrganizationUsage } from './usage';
import { lockOrganizationUser, readOrganizationPreferences } from './preferences';
import {
  lockOrganizationSource,
  matchesOrganizationRecord,
  OrganizationSettingsSchema,
} from './queue';

export const ORGANIZATION_LEASE_MS = 90_000;
export const ORGANIZATION_DEADLINE_MS = 15 * 60_000;
export const ORGANIZATION_SECTION_ATTEMPTS = 3;
export const ORGANIZATION_EXECUTION_ATTEMPTS = 3;
export type OrganizationLease = { id: string; userId: string; leaseOwner: string; attempt: number };
function lockExecution(tx: Prisma.TransactionClient) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('voxen:organization:execution', 0))`;
}
export function organizationFence(run: OrganizationLease) {
  return {
    id: run.id,
    userId: run.userId,
    leaseOwner: run.leaseOwner,
    attempt: run.attempt,
    status: 'RUNNING' as const,
    cancelRequestedAt: null,
    leaseExpiresAt: { gt: new Date() },
  };
}

/** Policy, source and run locks stay in this order through graph publication. */
export async function assertOrganizationLease(
  tx: Prisma.TransactionClient,
  run: OrganizationLease,
) {
  await lockOrganizationUser(tx, run.userId);
  if ((await readOrganizationPreferences(tx, run.userId)).mode === 'OFF')
    throw new OrganizationError('LEASE_LOST');
  const reference = await tx.organizationRun.findFirst({
    where: { id: run.id, userId: run.userId },
    select: { transcriptId: true },
  });
  if (!reference) throw new OrganizationError('LEASE_LOST');
  let record;
  try {
    record = await lockOrganizationSource(tx, run.userId, reference.transcriptId);
  } catch (error) {
    if (error instanceof OrganizationError && error.code === 'NOT_FOUND')
      throw new OrganizationError('LEASE_LOST');
    throw error;
  }
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "OrganizationRun" WHERE id = ${run.id} AND "userId" = ${run.userId} FOR UPDATE
  `;
  if (!locked.length) throw new OrganizationError('LEASE_LOST');
  const current = await tx.organizationRun.findFirst({ where: organizationFence(run) });
  if (!current || !matchesOrganizationRecord(current.generationSettings, record))
    throw new OrganizationError('LEASE_LOST');
  return { current, record };
}
export function withOrganizationLease<T>(
  run: OrganizationLease,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await assertOrganizationLease(tx, run);
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}
export async function renewOrganizationLease(run: OrganizationLease): Promise<void> {
  await db.$transaction(async (tx) => {
    // Claim and renewal take the global lock first so policy locks cannot
    // deadlock a heartbeat against a competing process's claim.
    await lockExecution(tx);
    await assertOrganizationLease(tx, run);
    const updated = await tx.organizationRun.updateMany({
      where: organizationFence(run),
      data: { leaseExpiresAt: new Date(Date.now() + ORGANIZATION_LEASE_MS) },
    });
    if (updated.count !== 1) throw new OrganizationError('LEASE_LOST');
  });
}
export async function claimOrganization(
  userId: string,
  id: string,
  owner: string = randomUUID(),
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    await lockExecution(tx);
    const active = await tx.organizationRun.findFirst({
      where: {
        status: 'RUNNING',
        cancelRequestedAt: null,
        leaseExpiresAt: { gt: now },
        generationSettings: { path: ['executorVersion'], equals: 1 },
      },
      select: { id: true },
    });
    if (active) return null;
    await lockOrganizationUser(tx, userId);
    const reference = await tx.organizationRun.findFirst({
      where: { id, userId },
      select: { transcriptId: true },
    });
    if (!reference) return null;
    const reject = async (status: 'FAILED' | 'CANCELLED', lastError: string) => {
      await tx.organizationRun.updateMany({
        where: { id, userId, status: { in: ['PENDING', 'RUNNING', 'RETRY'] } },
        data: {
          ...(await unconfirmedOrganizationUsage(tx, userId, id)),
          status,
          lastError,
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          revision: { increment: 1 },
        },
      });
      return null;
    };
    if ((await readOrganizationPreferences(tx, userId)).mode === 'OFF')
      return reject('CANCELLED', 'POLICY_CHANGED');
    let record;
    try {
      record = await lockOrganizationSource(tx, userId, reference.transcriptId);
    } catch (error) {
      if (error instanceof OrganizationError && error.code === 'NOT_FOUND')
        return reject('CANCELLED', 'SOURCE_CHANGED');
      throw error;
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "OrganizationRun" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE
    `;
    if (!locked.length) return null;
    const row = await tx.organizationRun.findFirstOrThrow({ where: { id, userId } });
    const runnable =
      ((row.status === 'PENDING' || row.status === 'RETRY') &&
        (!row.nextAttemptAt || row.nextAttemptAt <= now)) ||
      (row.status === 'RUNNING' && row.leaseExpiresAt !== null && row.leaseExpiresAt < now);
    if (!runnable || row.cancelRequestedAt) return null;
    if (!OrganizationSettingsSchema.safeParse(row.generationSettings).success)
      return reject('FAILED', 'INVALID_SETTINGS');
    if (!matchesOrganizationRecord(row.generationSettings, record))
      return reject('CANCELLED', 'SOURCE_CHANGED');
    if (row.startedAt && now.getTime() - row.startedAt.getTime() >= ORGANIZATION_DEADLINE_MS)
      return reject('FAILED', 'TIMEOUT');
    if (row.attempt >= ORGANIZATION_EXECUTION_ATTEMPTS)
      return reject('FAILED', 'ATTEMPTS_EXHAUSTED');
    const claimed = await tx.organizationRun.update({
      where: { id, userId },
      data: {
        status: 'RUNNING',
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + ORGANIZATION_LEASE_MS),
        startedAt: row.startedAt ?? now,
        nextAttemptAt: null,
        lastError: null,
        attempt: { increment: 1 },
        revision: { increment: 1 },
        ...(row.attempt === 0 ? { costUsd: 0 } : {}),
        ...(await unconfirmedOrganizationUsage(tx, userId, id)),
      },
    });
    return { ...claimed, leaseOwner: owner };
  });
}
