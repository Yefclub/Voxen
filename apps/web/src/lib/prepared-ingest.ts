// ============================================================================
// Prepared-content ingestion contract, v1 (spec 216, issue #895)
// ============================================================================
// Workspace-scoped idempotency for external producers: retrying with the same
// user + key resolves to the original target instead of creating a duplicate
// document or revision. Real updates carry a new key (or an expected revision
// on the revisioned write path) and preserve history explicitly.
// ============================================================================

import { Prisma } from '../../prisma-generated/client';
import { db } from './db';

export const PREPARED_CONTRACT_VERSION = '1';

type DbClient = Prisma.TransactionClient;

export type IngestTargetType = 'NOTE';

export type IngestKeyClaim = { created: true } | { created: false; targetId: string };

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

export function assertIngestContractVersion(version: string | undefined): void {
  if (version !== undefined && version !== PREPARED_CONTRACT_VERSION) {
    throw new PreparedIngestContractError(
      `Unsupported contract version ${JSON.stringify(version)}; expected "${PREPARED_CONTRACT_VERSION}".`,
    );
  }
}

export function assertIngestKey(key: string | undefined): asserts key is string {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw new PreparedIngestContractError(
      'Invalid idempotency key: 1-128 chars of letters, digits, ":", "_", "-".',
    );
  }
}

export class PreparedIngestContractError extends Error {
  code?: 'CONFLICT';
  constructor(message: string, code?: 'CONFLICT') {
    super(message);
    this.name = 'PreparedIngestContractError';
    this.code = code;
  }
}

export async function claimIngestKey(
  tx: DbClient,
  args: {
    userId: string;
    key: string;
    targetType: IngestTargetType;
    targetId: string;
    producerId?: string;
    externalId?: string;
  },
): Promise<IngestKeyClaim> {
  const lockKey = `voxen:ingest:${args.userId}:${args.key}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const existing = await tx.preparedIngestKey.findUnique({
    where: { userId_key: { userId: args.userId, key: args.key } },
    select: { targetId: true, targetType: true },
  });
  if (existing) {
    if (existing.targetType !== args.targetType || existing.targetId !== args.targetId) {
      throw new PreparedIngestContractError(
        'Idempotency key already maps to a different target for this workspace.',
        'CONFLICT',
      );
    }
    return { created: false, targetId: existing.targetId };
  }
  try {
    await tx.preparedIngestKey.create({
      data: {
        userId: args.userId,
        key: args.key,
        targetType: args.targetType,
        targetId: args.targetId,
        producerId: args.producerId ?? null,
        externalId: args.externalId ?? null,
        contractVersion: PREPARED_CONTRACT_VERSION,
      },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await tx.preparedIngestKey.findUnique({
        where: { userId_key: { userId: args.userId, key: args.key } },
        select: { targetId: true, targetType: true },
      });
      if (!raced) throw error;
      if (raced.targetType !== args.targetType || raced.targetId !== args.targetId) {
        throw new PreparedIngestContractError(
          'Idempotency key already maps to a different target for this workspace.',
          'CONFLICT',
        );
      }
      return { created: false, targetId: raced.targetId };
    }
    throw error;
  }
  return { created: true };
}

export async function findIngestTarget(
  userId: string,
  key: string,
): Promise<{ targetType: string; targetId: string } | null> {
  return db.preparedIngestKey.findUnique({
    where: { userId_key: { userId, key } },
    select: { targetType: true, targetId: true },
  });
}
