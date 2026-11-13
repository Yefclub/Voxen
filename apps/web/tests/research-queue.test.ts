import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { saveResearchPreferences } from '../src/lib/research/preferences';
import { enqueueResearch } from '../src/lib/research/queue';
import { claimResearch, withResearchLease, renewResearchLease } from '../src/lib/research/lease';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('owner-bound durable research queue', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `research-queue-${randomUUID()}@example.test`,
              name: 'Research queue',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId: { in: users }, scope: 'USER' } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function document(userId = users[0]!) {
    return db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/research',
        title: 'Source evidence',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'fixture.md',
        plainText: 'A source with version one.',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'checksum-one',
      },
    });
  }
  test('requires opt-in and makes foreign and missing sources indistinguishable', async () => {
    const doc = await document();
    expect(await enqueueResearch(users[0]!, doc.id, 'AUTO')).toBeNull();
    await expect(enqueueResearch(users[0]!, doc.id, 'MANUAL', randomUUID())).rejects.toThrow(
      'DISABLED',
    );
    await saveResearchPreferences(users[1]!, 'MANUAL');
    for (const id of [doc.id, 'missing-id'])
      await expect(enqueueResearch(users[1]!, id, 'MANUAL', randomUUID())).rejects.toThrow(
        'NOT_FOUND',
      );
    expect(await db.transcriptEnrichment.count({ where: { transcriptId: doc.id } })).toBe(0);
  });
  test('deduplicates concurrent submissions and request retries after completion', async () => {
    await saveResearchPreferences(users[0]!, 'MANUAL');
    const doc = await document();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => enqueueResearch(users[0]!, doc.id, 'MANUAL', key)),
    );
    expect(new Set(results.map((row) => row!.id)).size).toBe(1);
    const row = results[0]!;
    expect(row.generationSettings).toMatchObject({
      executorVersion: 1,
      snapshot: { sourceVersion: 1, sourceChecksum: 'checksum-one', correctionRevision: 0 },
    });
    await db.transcriptEnrichment.update({
      where: { id: row.id },
      data: { status: 'NO_RESEARCH_NEEDED' },
    });
    expect((await enqueueResearch(users[0]!, doc.id, 'MANUAL', key))!.id).toBe(row.id);
    expect((await enqueueResearch(users[0]!, doc.id, 'MANUAL', randomUUID()))!.id).not.toBe(row.id);
  });
  test('automatic work deduplicates by source version and respects manual mode', async () => {
    const doc = await document();
    expect(await enqueueResearch(users[0]!, doc.id, 'AUTO')).toBeNull();
    await saveResearchPreferences(users[0]!, 'AUTO');
    const first = await enqueueResearch(users[0]!, doc.id, 'AUTO');
    expect((await enqueueResearch(users[0]!, doc.id, 'AUTO'))!.id).toBe(first!.id);
    await db.transcript.update({
      where: { id: doc.id },
      data: {
        sourceVersion: 2,
        sourceChecksum: 'checksum-two',
        plainText: 'A new source version.',
      },
    });
    expect(await db.transcriptEnrichment.findUnique({ where: { id: first!.id } })).toMatchObject({
      status: 'CANCELLED',
      staleReason: 'source-version-changed',
    });
    const second = await enqueueResearch(users[0]!, doc.id, 'AUTO');
    expect(second!.id).not.toBe(first!.id);
    expect(second!.sourceVersion).toBe(2);
  });
  test('keeps a replacement claim outside an in-progress publication transaction', async () => {
    await saveResearchPreferences(users[0]!, 'MANUAL');
    const doc = await document();
    const queued = (await enqueueResearch(users[0]!, doc.id, 'MANUAL', randomUUID()))!;
    const run = (await claimResearch(users[0]!, queued.id, 'publishing-worker'))!;
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publication = withResearchLease(run, async (tx) => {
      entered();
      await held;
      await tx.transcriptEnrichment.update({
        where: { id: run.id },
        data: { status: 'READY', content: 'One committed result.' },
      });
    });
    try {
      await ready;
      // Advancing the claim clock simulates expiry without timing-dependent sleeps.
      expect(
        await claimResearch(
          users[0]!,
          run.id,
          'replacement-worker',
          new Date(Date.now() + 120_000),
        ),
      ).toBeNull();
    } finally {
      release();
      await publication;
    }
    expect(await db.transcriptEnrichment.findUnique({ where: { id: run.id } })).toMatchObject({
      status: 'READY',
      content: 'One committed result.',
      attempt: 1,
    });
  });

  test('allows only one valid execution lease across different owners', async () => {
    await saveResearchPreferences(users[0]!, 'MANUAL');
    await saveResearchPreferences(users[1]!, 'MANUAL');
    const a = await document(users[0]!);
    const b = await document(users[1]!);
    const jobs = [
      (await enqueueResearch(users[0]!, a.id, 'MANUAL', randomUUID()))!,
      (await enqueueResearch(users[1]!, b.id, 'MANUAL', randomUUID()))!,
    ];
    const claimed = await Promise.all(jobs.map((job) => claimResearch(job.userId, job.id)));
    const active = claimed.filter((job) => job !== null);
    expect(active).toHaveLength(1);
    const owner = active[0]!;
    const waiting = jobs.find((job) => job.id !== owner.id)!;
    await renewResearchLease(owner);
    expect(await claimResearch(waiting.userId, waiting.id)).toBeNull();
    await db.transcriptEnrichment.update({
      where: { id: owner.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await expect(renewResearchLease(owner)).rejects.toThrow('LEASE_LOST');
    const replacement = await claimResearch(waiting.userId, waiting.id);
    expect(replacement?.id).toBe(waiting.id);
    await expect(renewResearchLease(owner)).rejects.toThrow('LEASE_LOST');

    await db.transcriptEnrichment.updateMany({
      where: { id: { in: jobs.map((job) => job.id) } },
      data: { status: 'CANCELLED', leaseOwner: null, leaseExpiresAt: null },
    });
  });

  test('claims once, fences an expired owner and does not publish after source changes', async () => {
    await saveResearchPreferences(users[0]!, 'MANUAL');
    const doc = await document();
    const queued = (await enqueueResearch(users[0]!, doc.id, 'MANUAL', randomUUID()))!;
    const first = (await claimResearch(users[0]!, queued.id, 'first-worker'))!;
    expect(first.attempt).toBe(1);
    expect(await claimResearch(users[0]!, queued.id, 'competing-worker')).toBeNull();
    await db.transcriptEnrichment.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const originalStart = new Date(Date.now() - 5_000);
    await db.transcriptEnrichment.update({
      where: { id: first.id },
      data: { startedAt: originalStart },
    });
    const next = (await claimResearch(users[0]!, queued.id, 'second-worker'))!;
    expect(next.startedAt).toEqual(originalStart);
    expect(next.attempt).toBe(2);
    await expect(
      withResearchLease(first, async (tx) =>
        tx.transcriptEnrichment.update({
          where: { id: first.id },
          data: { content: 'Obsolete owner output.' },
        }),
      ),
    ).rejects.toThrow('LEASE_LOST');
    await withResearchLease(next, async (tx) => {
      await tx.transcriptEnrichment.update({
        where: { id: next.id },
        data: { rationale: 'Still current.' },
      });
    });
    await db.transcript.update({
      where: { id: doc.id },
      data: {
        correctionRevision: 1,
        correctedChecksum: 'corrected',
        correctedPlainText: 'Corrected evidence.',
      },
    });
    await expect(
      withResearchLease(next, async (tx) =>
        tx.transcriptEnrichment.update({
          where: { id: next.id },
          data: { content: 'Stale source output.' },
        }),
      ),
    ).rejects.toThrow('LEASE_LOST');
    expect(await db.transcriptEnrichment.findUnique({ where: { id: queued.id } })).toMatchObject({
      status: 'CANCELLED',
      content: '',
      rationale: 'Still current.',
    });
  });
});
