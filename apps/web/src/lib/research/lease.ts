import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { getResearchPreferences, lockResearchUser, readResearchPreferences } from './preferences';
import {
  lockResearchSource,
  matchesResearchSource,
  RESEARCH_SOURCE_SELECT,
  ResearchError,
  type ResearchSource,
} from './queue';

export const RESEARCH_LEASE_MS = 90_000;
export const RESEARCH_MAX_ATTEMPTS = 3;
export type ResearchLease = { id: string; userId: string; leaseOwner: string };
export async function claimResearch(
  userId: string,
  id: string,
  owner: string = randomUUID(),
  now = new Date(),
) {
  if ((await getResearchPreferences(userId)).mode === 'OFF') return null;
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT enrichment.id FROM "TranscriptEnrichment" enrichment
      JOIN "Transcript" source ON source.id = enrichment."transcriptId" AND source."userId" = enrichment."userId"
      JOIN "User" owner ON owner.id = enrichment."userId"
      WHERE enrichment.id = ${id} AND enrichment."userId" = ${userId}
        AND source.status = 'ACTIVE' AND owner.status = 'APPROVED'
        AND enrichment."staleReason" IS NULL AND enrichment."cancelRequestedAt" IS NULL
        AND enrichment."generationSettings"->>'executorVersion' = '1'
        AND ((enrichment.status IN ('PENDING','RETRY') AND (enrichment."nextAttemptAt" IS NULL OR enrichment."nextAttemptAt" <= ${now}))
          OR (enrichment.status = 'RUNNING' AND enrichment."leaseExpiresAt" < ${now}))
      FOR UPDATE OF enrichment SKIP LOCKED
    `;
    if (!rows.length) return null;
    const row = await tx.transcriptEnrichment.findFirstOrThrow({ where: { id, userId } });
    if (row.attempt >= RESEARCH_MAX_ATTEMPTS) {
      await tx.transcriptEnrichment.update({
        where: { id },
        data: {
          status: 'FAILED',
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: 'TIMEOUT',
          revision: { increment: 1 },
        },
      });
      return null;
    }
    const source = await tx.transcript.findFirst({
      where: { id: row.transcriptId, userId, status: 'ACTIVE' },
      select: RESEARCH_SOURCE_SELECT,
    });
    if (!source || !matchesResearchSource(row.generationSettings, source)) {
      await tx.transcriptEnrichment.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          staleReason: 'source-version-changed',
          revision: { increment: 1 },
        },
      });
      return null;
    }
    const claimed = await tx.transcriptEnrichment.update({
      where: { id },
      data: {
        status: 'RUNNING',
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + RESEARCH_LEASE_MS),
        startedAt: now,
        nextAttemptAt: null,
        attempt: { increment: 1 },
        lastError: null,
        revision: { increment: 1 },
      },
    });
    return { ...claimed, leaseOwner: owner };
  });
}
export function researchFence(run: ResearchLease) {
  return {
    id: run.id,
    userId: run.userId,
    leaseOwner: run.leaseOwner,
    status: 'RUNNING' as const,
    cancelRequestedAt: null,
    staleReason: null,
    leaseExpiresAt: { gt: new Date() },
  };
}
export async function assertResearchLease(run: ResearchLease) {
  const row = await db.transcriptEnrichment.findFirst({
    where: {
      ...researchFence(run),
      user: { status: 'APPROVED' },
      transcript: { userId: run.userId, status: 'ACTIVE' },
    },
    select: { id: true },
  });
  if (!row || (await getResearchPreferences(run.userId)).mode === 'OFF')
    throw new ResearchError('LEASE_LOST');
}
export async function withResearchLease<T>(
  run: ResearchLease,
  fn: (tx: Prisma.TransactionClient, source: ResearchSource) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await lockResearchUser(tx, run.userId);
    if ((await readResearchPreferences(tx, run.userId)).mode === 'OFF')
      throw new ResearchError('LEASE_LOST');
    const reference = await tx.transcriptEnrichment.findFirst({
      where: { id: run.id, userId: run.userId },
      select: { transcriptId: true },
    });
    if (!reference) throw new ResearchError('LEASE_LOST');
    let source: ResearchSource;
    try {
      source = await lockResearchSource(tx, run.userId, reference.transcriptId);
    } catch (error) {
      if (error instanceof ResearchError && error.code === 'NOT_FOUND')
        throw new ResearchError('LEASE_LOST');
      throw error;
    }
    // Source updates lock parent then child. Keep the same order, and retain the
    // child lock until publication commits so cancellation/reclaim cannot race it.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "TranscriptEnrichment" WHERE id = ${run.id} AND "userId" = ${run.userId} FOR UPDATE
    `;
    if (!locked.length) throw new ResearchError('LEASE_LOST');
    const row = await tx.transcriptEnrichment.findFirst({ where: researchFence(run) });
    if (!row || !matchesResearchSource(row.generationSettings, source))
      throw new ResearchError('LEASE_LOST');
    return fn(tx, source);
  });
}
