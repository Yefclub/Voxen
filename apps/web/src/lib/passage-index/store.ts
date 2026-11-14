import { randomUUID } from 'node:crypto';
import { db } from '../db';
import type { buildPassages } from './build';
import {
  readPassageRecord,
  PassageSourceError,
  type loadPassageSource,
  type PassageIdentity,
} from './source';

export type PassageClaim = PassageIdentity & { generation: bigint; token: string; attempt: number };
export const passageWhere = (identity: PassageIdentity) => ({
  userId: identity.userId,
  sourceType: identity.type,
  sourceId: identity.id,
});

export async function claimPassageIndex(
  identity: PassageIdentity,
  now = new Date(),
): Promise<PassageClaim | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ generation: bigint; attempt: number }>>`
      SELECT s.generation, s.attempt FROM "PassageIndexSource" s JOIN "User" u ON u.id = s."userId"
      WHERE s."userId" = ${identity.userId} AND s."sourceType" = ${identity.type} AND s."sourceId" = ${identity.id}
        AND u.status = 'APPROVED' AND (
          (s.status IN ('PENDING', 'RETRY') AND (s."nextAttemptAt" IS NULL OR s."nextAttemptAt" <= ${now}))
          OR (s.status = 'RUNNING' AND s."leaseExpiresAt" <= ${now})
        ) FOR UPDATE OF s SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return null;
    const where = { userId_sourceType_sourceId: passageWhere(identity) };
    if (row.attempt >= 3) {
      await tx.passageIndexSource.update({
        where,
        data: {
          status: 'FAILED',
          errorCode: 'ATTEMPTS_EXHAUSTED',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      return null;
    }
    const token = randomUUID(),
      attempt = row.attempt + 1;
    await tx.passageIndexSource.update({
      where,
      data: {
        status: 'RUNNING',
        attempt,
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        nextAttemptAt: null,
        errorCode: null,
      },
    });
    return { ...identity, generation: row.generation, token, attempt };
  });
}

const claimWhere = (claim: PassageClaim) => ({
  ...passageWhere(claim),
  generation: claim.generation,
  status: 'RUNNING',
  leaseToken: claim.token,
  attempt: claim.attempt,
  leaseExpiresAt: { gt: new Date() },
});

/** Canonical rows precede the ledger lock; source triggers use the same order. */
export async function publishPassageIndex(
  claim: PassageClaim,
  loaded: Awaited<ReturnType<typeof loadPassageSource>>,
  built: ReturnType<typeof buildPassages>,
): Promise<boolean> {
  const source = loaded.source;
  if (source.userId !== claim.userId || source.id !== claim.id || source.type !== claim.type)
    throw new PassageSourceError('STALE_REVISION');
  return db.$transaction(
    async (tx) => {
      let current;
      try {
        current = await readPassageRecord(claim, tx, true);
      } catch (error) {
        if (error instanceof PassageSourceError && error.code === 'NOT_FOUND') return false;
        throw error;
      }
      if (current.revision !== source.revision) return false;
      const rows = await tx.$queryRaw<Array<{ generation: bigint }>>`
      SELECT generation FROM "PassageIndexSource"
      WHERE "userId" = ${claim.userId} AND "sourceType" = ${claim.type} AND "sourceId" = ${claim.id}
        AND generation = ${claim.generation} AND status = 'RUNNING' AND attempt = ${claim.attempt}
        AND "leaseToken" = ${claim.token} AND "leaseExpiresAt" > CURRENT_TIMESTAMP FOR UPDATE
    `;
      if (!rows.length) return false;
      await tx.retrievalPassage.deleteMany({ where: passageWhere(claim) });
      for (let start = 0; start < built.passages.length; start += 200)
        await tx.retrievalPassage.createMany({
          data: built.passages.slice(start, start + 200).map((p) => ({
            ...p,
            ...passageWhere(claim),
          })),
        });
      const receipt = await tx.passageIndexSource.updateMany({
        where: claimWhere(claim),
        data: {
          status: 'READY',
          indexedGeneration: claim.generation,
          title: source.title,
          revision: source.revision,
          checksum: built.checksum,
          snapshot: built.snapshot,
          limitations: loaded.limitations,
          passageCount: built.passages.length,
          indexedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          errorCode: null,
        },
      });
      if (!receipt.count) throw new PassageSourceError('STALE_REVISION');
      return true;
    },
    { timeout: 30_000 },
  );
}

export async function failPassageIndex(claim: PassageClaim, code: string, retry: boolean) {
  return db.$transaction(async (tx) => {
    const hidden = code === 'NOT_FOUND';
    const status = hidden ? 'HIDDEN' : retry && claim.attempt < 3 ? 'RETRY' : 'FAILED';
    const result = await tx.passageIndexSource.updateMany({
      where: claimWhere(claim),
      data: {
        status,
        errorCode: code,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: status === 'RETRY' ? new Date(Date.now() + 1000 * 2 ** claim.attempt) : null,
      },
    });
    if (result.count && hidden)
      await tx.retrievalPassage.deleteMany({ where: passageWhere(claim) });
  });
}
