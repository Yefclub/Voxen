import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { getResearchPreferences, saveResearchPreferences } from '../src/lib/research/preferences';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('research consent and source invalidation', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `research-policy-${randomUUID()}@example.test`,
              name: 'Research policy',
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
        title: 'An original source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'fixture.md',
        plainText: 'Original source content.',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'original-checksum',
      },
    });
  }
  test('defaults to off and cancelling on a consent change affects only the owner', async () => {
    expect(await getResearchPreferences(users[0]!)).toMatchObject({
      mode: 'OFF',
      automaticSince: null,
    });
    await saveResearchPreferences(users[0]!, 'MANUAL');
    const one = await document();
    const two = await document(users[1]);
    const pending = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: one.id,
        runKey: randomUUID(),
        trigger: 'MANUAL',
        status: 'RUNNING',
        leaseOwner: 'old-owner',
        leaseExpiresAt: new Date(Date.now() + 90_000),
      },
    });
    const foreign = await db.transcriptEnrichment.create({
      data: { userId: users[1]!, transcriptId: two.id, runKey: randomUUID(), trigger: 'MANUAL' },
    });
    await saveResearchPreferences(users[0]!, 'OFF');
    expect(await db.transcriptEnrichment.findUnique({ where: { id: pending.id } })).toMatchObject({
      status: 'CANCELLED',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: 'POLICY_CHANGED',
    });
    expect(await db.transcriptEnrichment.findUnique({ where: { id: foreign.id } })).toMatchObject({
      status: 'PENDING',
      cancelRequestedAt: null,
    });
    expect(await db.transcript.findUnique({ where: { id: one.id } })).toMatchObject({
      plainText: 'Original source content.',
      sourceVersion: 1,
    });
  });
  test('a failed cancellation rolls back the preference update in the same transaction', async () => {
    await saveResearchPreferences(users[0]!, 'MANUAL');
    const doc = await document();
    const row = await db.transcriptEnrichment.create({
      data: { userId: users[0]!, transcriptId: doc.id, runKey: randomUUID(), trigger: 'MANUAL' },
    });
    const name = `research_policy_fault_${randomUUID().replaceAll('-', '')}`;
    expect(users[0]).toMatch(/^[a-z0-9]+$/);
    // Identifiers and the trigger argument are generated isolated fixture data.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = TG_ARGV[0] AND NEW.status = 'CANCELLED' THEN RAISE EXCEPTION 'injected research policy failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE UPDATE ON "TranscriptEnrichment" FOR EACH ROW EXECUTE FUNCTION ${name}('${users[0]}')`,
      );
      await expect(saveResearchPreferences(users[0]!, 'OFF')).rejects.toThrow();
      expect(await getResearchPreferences(users[0]!)).toMatchObject({ mode: 'MANUAL' });
      expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
        status: 'PENDING',
        cancelRequestedAt: null,
      });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "TranscriptEnrichment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
  test('archiving hides accepted context without making it stale after an unchanged restore', async () => {
    const doc = await document();
    const accepted = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: doc.id,
        runKey: randomUUID(),
        trigger: 'MANUAL',
        status: 'READY',
        reviewState: 'ACCEPTED',
        sourceVersion: 1,
        sourceChecksum: 'original-checksum',
        content: 'Previously accepted context.',
      },
    });
    await db.transcript.update({ where: { id: doc.id }, data: { status: 'ARCHIVED' } });
    await db.transcript.update({ where: { id: doc.id }, data: { status: 'ACTIVE' } });
    expect(await db.transcriptEnrichment.findUnique({ where: { id: accepted.id } })).toMatchObject({
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: null,
      content: 'Previously accepted context.',
    });
  });

  test('source corrections invalidate accepted evidence atomically and archive cancels pending work', async () => {
    const doc = await document();
    const accepted = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: doc.id,
        runKey: randomUUID(),
        trigger: 'MANUAL',
        status: 'READY',
        reviewState: 'ACCEPTED',
        sourceVersion: 1,
        sourceChecksum: 'original-checksum',
        content: 'Retain this reviewed context.',
      },
    });
    await db.transcript.update({
      where: { id: doc.id },
      data: {
        correctionRevision: 1,
        correctedChecksum: 'new-correction',
        correctedPlainText: 'Corrected source content.',
      },
    });
    expect(await db.transcriptEnrichment.findUnique({ where: { id: accepted.id } })).toMatchObject({
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: 'source-version-changed',
      brainProjectionPending: true,
      content: 'Retain this reviewed context.',
    });
    const pending = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: doc.id,
        runKey: randomUUID(),
        trigger: 'MANUAL',
        status: 'RUNNING',
        leaseOwner: 'worker',
        leaseExpiresAt: new Date(Date.now() + 90_000),
      },
    });
    await db.transcript.update({ where: { id: doc.id }, data: { status: 'ARCHIVED' } });
    expect(await db.transcriptEnrichment.findUnique({ where: { id: pending.id } })).toMatchObject({
      status: 'CANCELLED',
      leaseOwner: null,
      leaseExpiresAt: null,
      staleReason: 'parent-inactive',
    });
    expect(await db.transcript.findUnique({ where: { id: doc.id } })).toMatchObject({
      plainText: 'Original source content.',
      correctedPlainText: 'Corrected source content.',
    });
  });
});
