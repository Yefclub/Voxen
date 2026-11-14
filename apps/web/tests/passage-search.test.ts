import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { executePassageIndex } from '../src/lib/passage-index/runner';
import { searchPassages } from '../src/lib/passage-index/search';
import { readPassage } from '../src/lib/passage-index/read';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('current, owner-bound passage retrieval', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `passage-search-${randomUUID()}@example.test`,
              name: 'Passage search',
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
  async function note(content: string, title = 'Curated note', userId = users[0]!, indexed = true) {
    const row = await db.note.create({ data: { userId, title, content } });
    if (indexed) expect(await executePassageIndex({ userId, type: 'note', id: row.id })).toBe(true);
    return row;
  }
  test('finds Portuguese and English inflections and returns bounded literal evidence with stable references', async () => {
    const en = await note('# Findings\nThe researchers run experimental retrieval workflows.\n');
    const pt = await note('# Pesquisa\nOrganizações brasileiras pesquisam conteúdo relevante.\n');
    for (const [query, expected] of [
      ['running workflows', en],
      ['organização brasileira', pt],
    ] as const) {
      const result = await searchPassages(users[0]!, { query });
      expect(result.limitations).toEqual([]);
      expect(result.results.some((p) => p.sourceId === expected.id)).toBe(true);
      const hit = result.results.find((p) => p.sourceId === expected.id)!;
      expect(hit.excerpt.length).toBeLessThanOrEqual(1200);
      expect(expected.content).toContain(hit.excerpt);
      expect(hit).toMatchObject({
        kind: 'ORIGINAL',
        authority: null,
        section: query.startsWith('running') ? 'Findings' : 'Pesquisa',
      });
      const read = await readPassage(users[0]!, hit.key, hit.revision);
      expect(read.text).toBe(expected.content.slice(hit.startOffset, hit.endOffset));
      expect(read.passageChecksum).toBe(hit.passageChecksum);
    }
  });
  test('retains punctuation-distinct exact identifiers and finds a middle passage in a long source', async () => {
    const cpp = await note('The C++ language has this exact identifier.');
    const cs = await note('The C# language has a different identifier.');
    const long = await note('a'.repeat(65_000) + ' EXACT-MIDDLE-739 ' + 'b'.repeat(65_000));
    for (const [query, expected] of [
      ['C++', cpp],
      ['C#', cs],
      ['EXACT-MIDDLE-739', long],
    ] as const) {
      const result = await searchPassages(users[0]!, { query });
      expect(new Set(result.results.map((p) => p.sourceId))).toEqual(new Set([expected.id]));
      expect(result.results[0]?.excerpt).toContain(query);
      expect(result.results[0]?.matchedBy).toBe('exact');
    }
  });
  test('applies owner and source filters before the result bound and orders ties deterministically', async () => {
    for (let i = 0; i < 5; i++) await note('A unique search passage.', 'Foreign match', users[1]);
    const owned = await note('A unique search passage.', 'Owned match');
    const first = await searchPassages(users[0]!, { query: 'unique search', limit: 1 });
    expect(first.results.map((p) => p.sourceId)).toEqual([owned.id]);
    expect((await searchPassages(users[0]!, { query: 'unique search', limit: 1 })).results).toEqual(
      first.results,
    );
    expect(
      (await searchPassages(users[0]!, { query: 'unique search', sourceTypes: ['transcript'] }))
        .results,
    ).toEqual([]);
    expect(
      (await searchPassages(users[0]!, { query: 'unique search', sourceIds: ['missing'] })).results,
    ).toEqual([]);
    await expect(
      readPassage(users[1]!, first.results[0]!.key, first.results[0]!.revision),
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      readPassage(users[1]!, '0'.repeat(64), first.results[0]!.revision),
    ).rejects.toThrow('NOT_FOUND');
  });
  test('hides stale text immediately before indexing and rejects old references after edit, folder conversion or deletion', async () => {
    const row = await note('A distinct previous observation.');
    const hit = (await searchPassages(users[0]!, { query: 'previous observation' })).results[0]!;
    await db.note.update({
      where: { id: row.id },
      data: { content: 'A completely current observation.', revision: 2 },
    });
    const stale = await searchPassages(users[0]!, { query: 'previous observation' });
    expect(stale.results).toEqual([]);
    expect(stale.limitations).toContain('PARTIAL_INDEX');
    await expect(readPassage(users[0]!, hit.key, hit.revision)).rejects.toThrow('STALE_REVISION');
    await executePassageIndex({ userId: users[0]!, type: 'note', id: row.id });
    const current = (await searchPassages(users[0]!, { query: 'current observation' })).results[0]!;
    expect(current.revision).not.toBe(hit.revision);
    await expect(readPassage(users[0]!, current.key, hit.revision)).rejects.toThrow(
      'STALE_REVISION',
    );
    await db.note.update({ where: { id: row.id }, data: { kind: 'FOLDER' } });
    expect((await searchPassages(users[0]!, { query: 'current observation' })).results).toEqual([]);
    await expect(readPassage(users[0]!, current.key, current.revision)).rejects.toThrow(
      'NOT_FOUND',
    );
    await db.note.delete({ where: { id: row.id } });
    expect((await searchPassages(users[0]!, { query: 'current observation' })).results).toEqual([]);
  });
  test('reports partial coverage and preserves lexical discovery while backfill is pending', async () => {
    const row = await note('A baseline fallback observation.', 'Pending document', users[0], false);
    const result = await searchPassages(users[0]!, { query: 'fallback observation' });
    expect(result.results).toEqual([]);
    expect(result.limitations).toContain('PARTIAL_INDEX');
    expect(result.coverage).toMatchObject({ total: 1, indexed: 0 });
    expect(result.baseline.some((p) => p.id === row.id && p.sourceType === 'note')).toBe(true);
  });
  test('reports index unavailability while canonical lexical search and reads remain usable', async () => {
    const row = await note('A baseline recovery observation.');
    await db.$executeRawUnsafe(
      'ALTER TABLE "RetrievalPassage" RENAME TO "RetrievalPassage_temporarily_unavailable"',
    );
    try {
      const result = await searchPassages(users[0]!, { query: 'recovery observation' });
      expect(result.results).toEqual([]);
      expect(result.limitations).toContain('INDEX_UNAVAILABLE');
      expect(result.baseline.some((p) => p.id === row.id)).toBe(true);
      expect(
        (await db.note.findFirstOrThrow({ where: { id: row.id, userId: users[0]! } })).content,
      ).toContain('recovery');
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "RetrievalPassage_temporarily_unavailable" RENAME TO "RetrievalPassage"',
      );
    }
  });
  test('narrows fallback to the requested accepted context before applying its limit', async () => {
    const parent = await db.transcript.create({
      data: {
        userId: users[0]!,
        title: 'Parent',
        source: 'WEB',
        url: 'https://example.test/parent',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'not-read.md',
        plainText: 'A separate canonical document.',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'first',
      },
    });
    const rows = await Promise.all(
      Array.from({ length: 3 }, () =>
        db.transcriptEnrichment.create({
          data: {
            userId: users[0]!,
            transcriptId: parent.id,
            runKey: randomUUID(),
            trigger: 'MANUAL',
            status: 'READY',
            reviewState: 'ACCEPTED',
            title: 'External observation',
            content: 'A fallback context observation.',
            sourceVersion: 1,
            sourceChecksum: 'first',
          },
        }),
      ),
    );
    const target = rows[2]!;
    const result = await searchPassages(users[0]!, {
      query: 'fallback context',
      limit: 1,
      sourceTypes: ['external_enrichment'],
      sourceIds: [target.id],
    });
    expect(result.results).toEqual([]);
    expect(result.coverage).toMatchObject({ total: 1, indexed: 0 });
    expect(result.baseline.map((p) => p.id)).toEqual([target.id]);
    expect(result.limitations).toContain('PARTIAL_INDEX');
  });
  test('rejects oversized queries and caller-controlled source scopes outside the bounded schema', async () => {
    for (const input of [
      { query: '' },
      { query: 'a'.repeat(301) },
      { query: 'hello', limit: 21 },
      { query: 'hello', sourceTypes: ['invalid'] },
      { query: 'hello', userId: users[1] },
    ])
      await expect(searchPassages(users[0]!, input as never)).rejects.toThrow();
  });
});
