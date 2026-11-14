import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { buildPassages } from '../src/lib/passage-index/build';
import {
  loadPassageSource,
  PassageSourceError,
  type PassageIdentity,
} from '../src/lib/passage-index/source';
import { claimPassageIndex, publishPassageIndex } from '../src/lib/passage-index/store';
import { executePassageIndex, backfillPassageSources } from '../src/lib/passage-index/runner';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
const where = (source: PassageIdentity) => ({
  userId: source.userId,
  sourceType: source.type,
  sourceId: source.id,
});
const head = (source: PassageIdentity) =>
  db.passageIndexSource.findUniqueOrThrow({
    where: { userId_sourceType_sourceId: where(source) },
  });

suite('durable versioned passage indexing', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `passage-index-${randomUUID()}@example.test`,
              name: 'Passage index',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.note.deleteMany({ where: { userId: { in: users } } });
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function note(userId = users[0]!, content = '# Source\nOrion is part of Vega.\n') {
    const row = await db.note.create({ data: { userId, title: 'Curated note', content } });
    return { userId, type: 'note' as const, id: row.id };
  }
  test('automatically indexes only the affected source and replays without duplicated passages', async () => {
    const source = await note(),
      other = await note(users[1]);
    expect((await head(source)).status).toBe('PENDING');
    expect(await executePassageIndex(source)).toBe(true);
    const before = await db.retrievalPassage.findMany({ where: where(source) });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      text: '# Source\nOrion is part of Vega.\n',
      kind: 'ORIGINAL',
      authority: null,
    });
    expect((await head(source)).status).toBe('READY');
    expect(await executePassageIndex(source)).toBe(false);
    expect(await db.retrievalPassage.findMany({ where: where(source) })).toEqual(before);
    const generation = (await head(source)).generation;
    await db.note.update({ where: { id: source.id }, data: { language: 'en' } });
    expect((await head(source)).generation).toBe(generation);
    await db.note.update({
      where: { id: source.id },
      data: { content: 'A corrected passage.', revision: 2 },
    });
    expect(await head(source)).toMatchObject({ status: 'PENDING', generation: generation + 1n });
    expect((await head(other)).generation).toBe(1n);
    await executePassageIndex(source);
    expect(
      (await db.retrievalPassage.findMany({ where: where(source) })).map((p) => p.text),
    ).toEqual(['A corrected passage.']);
  });
  test('fences an old indexing result after an edit instead of replacing the newer content', async () => {
    const source = await note();
    const claim = (await claimPassageIndex(source))!;
    const loaded = await loadPassageSource(source),
      old = buildPassages(loaded.source);
    await db.note.update({
      where: { id: source.id },
      data: { content: 'Current revision.', revision: 2 },
    });
    expect(await publishPassageIndex(claim, loaded, old)).toBe(false);
    expect(await db.retrievalPassage.count({ where: where(source) })).toBe(0);
    await executePassageIndex(source);
    expect((await db.retrievalPassage.findFirstOrThrow({ where: where(source) })).text).toBe(
      'Current revision.',
    );
  });
  test('recovers expired execution with a new token and rejects the former owner and excess attempts', async () => {
    const source = await note();
    const old = (await claimPassageIndex(source, new Date(Date.now() - 180_000)))!;
    const loaded = await loadPassageSource(source),
      built = buildPassages(loaded.source);
    const replacement = (await claimPassageIndex(source))!;
    expect(replacement.attempt).toBe(2);
    expect(replacement.token).not.toBe(old.token);
    expect(await publishPassageIndex(old, loaded, built)).toBe(false);
    expect(await publishPassageIndex(replacement, loaded, built)).toBe(true);
    expect((await head(source)).status).toBe('READY');
    await db.note.update({ where: { id: source.id }, data: { title: 'A new title' } });
    await claimPassageIndex(source, new Date(Date.now() - 500_000));
    await claimPassageIndex(source, new Date(Date.now() - 300_000));
    await claimPassageIndex(source, new Date(Date.now() - 150_000));
    expect(await claimPassageIndex(source)).toBeNull();
    expect(await head(source)).toMatchObject({ status: 'FAILED', errorCode: 'ATTEMPTS_EXHAUSTED' });
  });
  test('allows only one concurrent claim and never accepts another workspace identity', async () => {
    const source = await note();
    const claims = await Promise.all(Array.from({ length: 5 }, () => claimPassageIndex(source)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimPassageIndex({ ...source, userId: users[1]! })).toBeNull();
    expect((await head(source)).attempt).toBe(1);
  });
  test('invalidates accepted context with its parent and removes derived ledgers on canonical deletion', async () => {
    const row = await db.transcript.create({
      data: {
        userId: users[0]!,
        title: 'Parent',
        source: 'WEB',
        url: 'https://example.test/parent',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'not-read.md',
        plainText: 'Canonical body',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'first',
      },
    });
    const enrichment = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: row.id,
        runKey: randomUUID(),
        trigger: 'MANUAL',
        status: 'READY',
        reviewState: 'ACCEPTED',
        title: 'Accepted context',
        content: 'External evidence.',
        sourceVersion: 1,
        sourceChecksum: 'first',
      },
    });
    const source = { userId: users[0]!, type: 'external_enrichment' as const, id: enrichment.id };
    await executePassageIndex(source);
    const generation = (await head(source)).generation;
    await db.transcript.update({ where: { id: row.id }, data: { status: 'ARCHIVED' } });
    expect(await head(source)).toMatchObject({ generation: generation + 1n, status: 'PENDING' });
    await executePassageIndex(source);
    expect((await head(source)).status).toBe('HIDDEN');
    await db.transcript.update({ where: { id: row.id }, data: { status: 'ACTIVE' } });
    expect(await executePassageIndex(source)).toBe(true);
    await db.transcript.update({
      where: { id: row.id },
      data: { sourceVersion: 2, sourceChecksum: 'second' },
    });
    await executePassageIndex(source);
    expect((await head(source)).status).toBe('HIDDEN');
    await db.transcript.delete({ where: { id: row.id } });
    expect(
      await db.passageIndexSource.count({
        where: { userId: users[0]!, sourceId: { in: [row.id, enrichment.id] } },
      }),
    ).toBe(0);
    expect(await db.retrievalPassage.count({ where: where(source) })).toBe(0);
  });
  test('commits replacement passages and the ready receipt together', async () => {
    const source = await note();
    await executePassageIndex(source);
    const initial = await db.retrievalPassage.findMany({ where: where(source) });
    await db.note.update({
      where: { id: source.id },
      data: { content: 'Replacement text.', revision: 2 },
    });
    const claim = (await claimPassageIndex(source))!;
    const loaded = await loadPassageSource(source),
      built = buildPassages(loaded.source);
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION passage_receipt_fault() RETURNS trigger AS $$ BEGIN
      IF NEW."userId" = '${source.userId}' AND NEW.status = 'READY' THEN RAISE EXCEPTION 'receipt fault'; END IF;
      RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(
      'CREATE TRIGGER passage_receipt_fault BEFORE UPDATE ON "PassageIndexSource" FOR EACH ROW EXECUTE FUNCTION passage_receipt_fault()',
    );
    try {
      await expect(publishPassageIndex(claim, loaded, built)).rejects.toThrow('receipt fault');
      expect(await db.retrievalPassage.findMany({ where: where(source) })).toEqual(initial);
      expect((await head(source)).status).toBe('RUNNING');
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS passage_receipt_fault ON "PassageIndexSource"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS passage_receipt_fault()');
    }
    expect(await publishPassageIndex(claim, loaded, built)).toBe(true);
    expect((await db.retrievalPassage.findFirstOrThrow({ where: where(source) })).text).toBe(
      'Replacement text.',
    );
  });
  test('records unavailable-source failures explicitly and can retry after interruption', async () => {
    const source = await note();
    await executePassageIndex(source, async () => {
      throw new PassageSourceError('UNAVAILABLE_SOURCE');
    });
    expect(await head(source)).toMatchObject({ status: 'RETRY', errorCode: 'UNAVAILABLE_SOURCE' });
    expect(await db.retrievalPassage.count({ where: where(source) })).toBe(0);
    expect(await executePassageIndex(source)).toBe(false);
    await db.passageIndexSource.update({
      where: { userId_sourceType_sourceId: where(source) },
      data: { nextAttemptAt: new Date(0) },
    });
    expect(await executePassageIndex(source)).toBe(true);
    expect((await head(source)).status).toBe('READY');
  });
  test('hides folders, deletes derived rows with their source and keeps other workspaces intact', async () => {
    const source = await note(),
      foreign = await note(users[1]);
    await executePassageIndex(source);
    await executePassageIndex(foreign);
    await db.note.update({ where: { id: source.id }, data: { kind: 'FOLDER' } });
    await executePassageIndex(source);
    expect((await head(source)).status).toBe('HIDDEN');
    expect(await db.retrievalPassage.count({ where: where(source) })).toBe(0);
    await db.note.update({ where: { id: source.id }, data: { kind: 'NOTE' } });
    await executePassageIndex(source);
    expect((await head(source)).status).toBe('READY');
    await db.note.delete({ where: { id: source.id } });
    expect(await db.passageIndexSource.count({ where: where(source) })).toBe(0);
    expect(await db.retrievalPassage.count({ where: where(source) })).toBe(0);
    expect((await head(foreign)).status).toBe('READY');
    await db.user.update({ where: { id: users[1]! }, data: { status: 'DISABLED' } });
    expect(await claimPassageIndex(foreign)).toBeNull();
    await db.user.update({ where: { id: users[1]! }, data: { status: 'APPROVED' } });
    expect(await executePassageIndex(foreign)).toBe(true);
  });
  test('backfills existing sources in bounded restart-safe batches without modifying canonical content', async () => {
    const sources = await Promise.all(Array.from({ length: 5 }, () => note()));
    const before = await db.note.findMany({ where: { userId: users[0]! }, orderBy: { id: 'asc' } });
    await db.passageIndexSource.deleteMany({ where: { userId: users[0]! } });
    expect(await backfillPassageSources(users[0]!, 2)).toBe(2);
    expect(await backfillPassageSources(users[0]!, 2)).toBe(2);
    expect(await backfillPassageSources(users[0]!, 2)).toBe(1);
    expect(await backfillPassageSources(users[0]!, 2)).toBe(0);
    for (const source of sources) expect(await executePassageIndex(source)).toBe(true);
    expect(
      await db.note.findMany({ where: { userId: users[0]! }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
    expect(
      await db.passageIndexSource.count({ where: { userId: users[0]!, status: 'READY' } }),
    ).toBe(5);
  });
});
