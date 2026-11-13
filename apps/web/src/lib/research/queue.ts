import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { ACTIVE_RESEARCH_STATUSES, lockResearchUser, readResearchPreferences } from './preferences';

export class ResearchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ResearchError';
  }
}
export const RESEARCH_SOURCE_SELECT = {
  id: true,
  userId: true,
  title: true,
  plainText: true,
  correctedPlainText: true,
  sourceVersion: true,
  sourceChecksum: true,
  correctionRevision: true,
  correctedChecksum: true,
  correctionState: true,
} as const satisfies Prisma.TranscriptSelect;
export type ResearchSource = Prisma.TranscriptGetPayload<{ select: typeof RESEARCH_SOURCE_SELECT }>;
export function researchText(source: ResearchSource) {
  return source.correctionState === 'ACTIVE' && source.correctedPlainText !== null
    ? source.correctedPlainText
    : source.plainText;
}
function snapshot(source: ResearchSource) {
  return {
    title: source.title,
    correctionState: source.correctionState,
    sourceVersion: source.sourceVersion,
    sourceChecksum: source.sourceChecksum,
    correctionRevision: source.correctionRevision,
    correctedChecksum: source.correctedChecksum,
    bodyChecksum: createHash('sha256').update(researchText(source)).digest('hex'),
  };
}
export const ResearchSettingsSchema = z.object({
  executorVersion: z.literal(1),
  role: z.literal('standard'),
  mode: z.enum(['MANUAL', 'AUTO']),
  automaticSince: z.string().nullable(),
  snapshot: z.object({
    title: z.string(),
    correctionState: z.enum(['ACTIVE', 'STALE']),
    sourceVersion: z.number().int(),
    sourceChecksum: z.string().nullable(),
    correctionRevision: z.number().int(),
    correctedChecksum: z.string().nullable(),
    bodyChecksum: z.string().length(64),
  }),
});
export function matchesResearchSource(settings: unknown, source: ResearchSource) {
  const parsed = ResearchSettingsSchema.safeParse(settings);
  if (!parsed.success) return false;
  const old = parsed.data.snapshot;
  const current = snapshot(source);
  return (
    old.title === current.title &&
    old.correctionState === current.correctionState &&
    old.sourceVersion === current.sourceVersion &&
    old.sourceChecksum === current.sourceChecksum &&
    old.correctionRevision === current.correctionRevision &&
    old.correctedChecksum === current.correctedChecksum &&
    old.bodyChecksum === current.bodyChecksum
  );
}
export async function lockResearchSource(tx: Prisma.TransactionClient, userId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT transcript.id FROM "Transcript" transcript
    JOIN "User" owner ON owner.id = transcript."userId"
    WHERE transcript.id = ${id} AND transcript."userId" = ${userId}
      AND transcript.status = 'ACTIVE' AND owner.status = 'APPROVED'
    FOR UPDATE OF transcript
  `;
  if (!rows.length) throw new ResearchError('NOT_FOUND');
  return tx.transcript.findFirstOrThrow({ where: { id, userId }, select: RESEARCH_SOURCE_SELECT });
}
export async function enqueueResearch(
  userId: string,
  transcriptId: string,
  trigger: 'AUTO' | 'MANUAL',
  requestKey: string = randomUUID(),
) {
  if (trigger === 'MANUAL') z.string().uuid().parse(requestKey);
  return db.$transaction(async (tx) => {
    await lockResearchUser(tx, userId);
    const policy = await readResearchPreferences(tx, userId);
    if (trigger === 'AUTO' && policy.mode !== 'AUTO') return null;
    if (policy.mode === 'OFF') throw new ResearchError('DISABLED');
    const source = await lockResearchSource(tx, userId, transcriptId);
    if (trigger === 'AUTO') {
      if (!policy.automaticSince) return null;
      const captured = await tx.transcript.findFirst({
        where: {
          id: transcriptId,
          userId,
          sourceMetadata: { path: ['producer'], equals: 'voxen-capture' },
          sourceCollectedAt: { gte: new Date(policy.automaticSince) },
        },
        select: { id: true },
      });
      if (!captured) return null;
    }
    const settings = {
      executorVersion: 1 as const,
      role: 'standard' as const,
      mode: policy.mode,
      automaticSince: policy.automaticSince,
      snapshot: snapshot(source),
    };
    const runKey =
      trigger === 'AUTO'
        ? `auto:${createHash('sha256').update(JSON.stringify(settings)).digest('hex')}`
        : `manual:${requestKey}`;
    const previous = await tx.transcriptEnrichment.findUnique({
      where: { userId_transcriptId_runKey: { userId, transcriptId, runKey } },
    });
    if (previous) return previous;
    const active = await tx.transcriptEnrichment.findFirst({
      where: {
        userId,
        transcriptId,
        status: { in: [...ACTIVE_RESEARCH_STATUSES] },
        staleReason: null,
        generationSettings: { path: ['executorVersion'], equals: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return active;
    return tx.transcriptEnrichment.create({
      data: {
        userId,
        transcriptId,
        runKey,
        trigger,
        title: source.title,
        sourceVersion: source.sourceVersion,
        sourceChecksum: source.sourceChecksum,
        generationSettings: settings,
      },
    });
  });
}
