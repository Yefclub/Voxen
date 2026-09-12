import type { InterestEventKind } from '../../prisma-generated/client';
import { db } from './db';

export type TranscriptPreference = 'MORE' | 'LESS' | 'NONE';

export interface TranscriptInterestState {
  preference: TranscriptPreference;
  updatedAt: string | null;
}

const EXPLICIT_KINDS = ['PREFERENCE_MORE', 'PREFERENCE_LESS', 'PREFERENCE_CLEARED'] as const;

function preferenceForKind(kind: InterestEventKind): TranscriptPreference {
  if (kind === 'PREFERENCE_MORE') return 'MORE';
  if (kind === 'PREFERENCE_LESS') return 'LESS';
  return 'NONE';
}

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function findVisibleTranscript(userId: string, transcriptId: string) {
  return db.transcript.findFirst({
    where: { id: transcriptId, userId, status: { not: 'TRASH' } },
    select: { id: true },
  });
}

export async function readTranscriptInterest(params: {
  userId: string;
  transcriptId: string;
}): Promise<TranscriptInterestState | null> {
  const transcript = await findVisibleTranscript(params.userId, params.transcriptId);
  if (!transcript) return null;

  const latest = await db.interestEvent.findFirst({
    where: {
      userId: params.userId,
      transcriptId: params.transcriptId,
      origin: 'EXPLICIT',
      kind: { in: [...EXPLICIT_KINDS] },
    },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: { kind: true, occurredAt: true },
  });

  return {
    preference: latest ? preferenceForKind(latest.kind) : 'NONE',
    updatedAt: latest?.occurredAt.toISOString() ?? null,
  };
}

export async function recordTranscriptView(params: {
  userId: string;
  transcriptId: string;
  now?: Date;
}): Promise<{ recorded: boolean } | null> {
  const transcript = await findVisibleTranscript(params.userId, params.transcriptId);
  if (!transcript) return null;

  const now = params.now ?? new Date();
  const dedupeKey = `transcript-view:${params.transcriptId}:${utcDayKey(now)}`;
  const inserted = await db.interestEvent.createMany({
    data: [
      {
        userId: params.userId,
        transcriptId: params.transcriptId,
        origin: 'OBSERVED',
        kind: 'TRANSCRIPT_VIEWED',
        signal: 0,
        dedupeKey,
        metadata: { surface: 'transcript-detail' },
        occurredAt: now,
      },
    ],
    skipDuplicates: true,
  });
  return { recorded: inserted.count === 1 };
}

export async function setTranscriptPreference(params: {
  userId: string;
  transcriptId: string;
  preference: TranscriptPreference;
  now?: Date;
}): Promise<TranscriptInterestState | null> {
  const transcript = await findVisibleTranscript(params.userId, params.transcriptId);
  if (!transcript) return null;

  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    const latest = await tx.interestEvent.findFirst({
      where: {
        userId: params.userId,
        transcriptId: params.transcriptId,
        origin: 'EXPLICIT',
        kind: { in: [...EXPLICIT_KINDS] },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { kind: true },
    });
    const current = latest ? preferenceForKind(latest.kind) : 'NONE';
    const next =
      params.preference !== 'NONE' && params.preference === current ? 'NONE' : params.preference;
    const kind =
      next === 'MORE'
        ? 'PREFERENCE_MORE'
        : next === 'LESS'
          ? 'PREFERENCE_LESS'
          : 'PREFERENCE_CLEARED';

    await tx.interestEvent.create({
      data: {
        userId: params.userId,
        transcriptId: params.transcriptId,
        origin: 'EXPLICIT',
        kind,
        signal: next === 'MORE' ? 1 : next === 'LESS' ? -1 : 0,
        metadata: { surface: 'transcript-detail' },
        occurredAt: now,
      },
    });

    return { preference: next, updatedAt: now.toISOString() };
  });
}
