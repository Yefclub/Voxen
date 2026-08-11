import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from './db';
import {
  readTranscriptInterest,
  recordTranscriptView,
  setTranscriptPreference,
  utcDayKey,
} from './personal-interest-signals';

describe('personal interest signal contract', () => {
  test('uses a stable UTC day boundary for observed signal deduplication', () => {
    expect(utcDayKey(new Date('2026-08-11T23:59:59.999Z'))).toBe('2026-08-11');
    expect(utcDayKey(new Date('2026-08-12T00:00:00.000Z'))).toBe('2026-08-12');
  });
});

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('personal interest persistence and isolation', () => {
  let ownerId = '';
  let foreignId = '';
  let transcriptId = '';
  let archivedTranscriptId = '';
  let cascadeTranscriptId = '';
  let foreignTranscriptId = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `interest-owner-${suffix}@voxen.local`,
          name: 'Interest owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `interest-foreign-${suffix}@voxen.local`,
          name: 'Interest foreign user',
          status: 'APPROVED',
        },
      }),
    ]);
    ownerId = owner.id;
    foreignId = foreign.id;

    const createTranscript = (title: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') =>
      db.transcript.create({
        data: {
          userId: ownerId,
          status,
          source: 'YOUTUBE',
          url: `https://example.test/${suffix}/${encodeURIComponent(title)}`,
          title,
          durationSec: 90,
          language: 'en',
          transcriptionMethod: 'SUBTITLES',
          mdPath: `tests/${suffix}/${title}.md`,
          plainText: `Knowledge for ${title}.`,
          frontmatter: {},
          ...(status === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
        },
      });
    const [active, archived, cascade] = await Promise.all([
      createTranscript('Active interest'),
      createTranscript('Archived interest', 'ARCHIVED'),
      createTranscript('Cascade interest'),
    ]);
    transcriptId = active.id;
    archivedTranscriptId = archived.id;
    cascadeTranscriptId = cascade.id;
    const foreignTranscript = await db.transcript.create({
      data: {
        userId: foreignId,
        source: 'WEB',
        url: `https://example.test/${suffix}/foreign`,
        title: 'Foreign interest',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: `tests/${suffix}/foreign.md`,
        plainText: 'Knowledge owned by another user.',
        frontmatter: {},
      },
    });
    foreignTranscriptId = foreignTranscript.id;
  });

  afterAll(async () => {
    if (ownerId) await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    if (foreignId) await db.user.delete({ where: { id: foreignId } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('records at most one observed view per transcript and UTC day', async () => {
    const first = await recordTranscriptView({
      userId: ownerId,
      transcriptId,
      now: new Date('2026-08-11T08:00:00.000Z'),
    });
    const duplicate = await recordTranscriptView({
      userId: ownerId,
      transcriptId,
      now: new Date('2026-08-11T22:00:00.000Z'),
    });
    const nextDay = await recordTranscriptView({
      userId: ownerId,
      transcriptId,
      now: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(first).toEqual({ recorded: true });
    expect(duplicate).toEqual({ recorded: false });
    expect(nextDay).toEqual({ recorded: true });
    expect(
      await db.interestEvent.count({
        where: { userId: ownerId, transcriptId, origin: 'OBSERVED' },
      }),
    ).toBe(2);
  });

  test('keeps observed views separate from the explicit preference', async () => {
    expect(await readTranscriptInterest({ userId: ownerId, transcriptId })).toEqual({
      preference: 'NONE',
      updatedAt: null,
    });
  });

  test('appends and toggles explicit preferences without deleting history', async () => {
    const moreAt = new Date('2026-08-12T10:00:00.000Z');
    const clearedAt = new Date('2026-08-12T10:01:00.000Z');
    const lessAt = new Date('2026-08-12T10:02:00.000Z');

    expect(
      await setTranscriptPreference({
        userId: ownerId,
        transcriptId,
        preference: 'MORE',
        now: moreAt,
      }),
    ).toEqual({ preference: 'MORE', updatedAt: moreAt.toISOString() });
    expect(
      await setTranscriptPreference({
        userId: ownerId,
        transcriptId,
        preference: 'MORE',
        now: clearedAt,
      }),
    ).toEqual({ preference: 'NONE', updatedAt: clearedAt.toISOString() });
    expect(
      await setTranscriptPreference({
        userId: ownerId,
        transcriptId,
        preference: 'LESS',
        now: lessAt,
      }),
    ).toEqual({ preference: 'LESS', updatedAt: lessAt.toISOString() });
    expect(await readTranscriptInterest({ userId: ownerId, transcriptId })).toEqual({
      preference: 'LESS',
      updatedAt: lessAt.toISOString(),
    });

    const events = await db.interestEvent.findMany({
      where: { userId: ownerId, transcriptId, origin: 'EXPLICIT' },
      orderBy: { occurredAt: 'asc' },
      select: { kind: true, signal: true, metadata: true },
    });
    expect(events).toEqual([
      { kind: 'PREFERENCE_MORE', signal: 1, metadata: { surface: 'transcript-detail' } },
      { kind: 'PREFERENCE_CLEARED', signal: 0, metadata: { surface: 'transcript-detail' } },
      { kind: 'PREFERENCE_LESS', signal: -1, metadata: { surface: 'transcript-detail' } },
    ]);
  });

  test('supports archived transcripts and hides foreign or trashed content', async () => {
    expect(
      await setTranscriptPreference({
        userId: ownerId,
        transcriptId: archivedTranscriptId,
        preference: 'MORE',
      }),
    ).toMatchObject({ preference: 'MORE' });
    expect(
      await readTranscriptInterest({ userId: foreignId, transcriptId: archivedTranscriptId }),
    ).toBeNull();
    expect(
      await recordTranscriptView({ userId: foreignId, transcriptId: archivedTranscriptId }),
    ).toBeNull();

    await db.transcript.update({ where: { id: archivedTranscriptId }, data: { status: 'TRASH' } });
    expect(
      await readTranscriptInterest({ userId: ownerId, transcriptId: archivedTranscriptId }),
    ).toBeNull();
    expect(
      await setTranscriptPreference({
        userId: ownerId,
        transcriptId: archivedTranscriptId,
        preference: 'LESS',
      }),
    ).toBeNull();
  });

  test('enforces transcript ownership at the database boundary', async () => {
    const invalidWrite = Promise.resolve(
      db.interestEvent.create({
        data: {
          userId: ownerId,
          transcriptId: foreignTranscriptId,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_MORE',
          signal: 1,
        },
      }),
    );
    await expect(invalidWrite).rejects.toMatchObject({ code: 'P2003' });
  });

  test('removes personal events when the transcript is permanently deleted', async () => {
    await Promise.all([
      recordTranscriptView({ userId: ownerId, transcriptId: cascadeTranscriptId }),
      setTranscriptPreference({
        userId: ownerId,
        transcriptId: cascadeTranscriptId,
        preference: 'MORE',
      }),
    ]);
    expect(await db.interestEvent.count({ where: { transcriptId: cascadeTranscriptId } })).toBe(2);

    await db.transcript.delete({ where: { id: cascadeTranscriptId } });
    expect(await db.interestEvent.count({ where: { transcriptId: cascadeTranscriptId } })).toBe(0);
  });
});
