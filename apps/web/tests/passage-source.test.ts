import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';
import { loadPassageSource } from '../src/lib/passage-index/source';
import { buildPassages } from '../src/lib/passage-index/build';

const root = mkdtempSync(join(tmpdir(), 'voxen-passage-source-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
const summary = '# Original source\nA generated interpretation.\n\n';
const original = '# Summary\n[00:00:12] Orion belongs to Vega.\n';
const body = summary + original;

suite('canonical owner-bound passage sources', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `passage-source-${randomUUID()}@example.test`,
              name: 'Passage source',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
    rmSync(root, { recursive: true, force: true });
  });
  async function document(owner = users[0]!) {
    const id = randomUUID(),
      mdPath = `workspaces/${owner}/transcripts/${id}/source.md`;
    await storagePut({ key: mdPath, body, contentType: 'text/markdown' });
    return db.transcript.create({
      data: {
        id,
        userId: owner,
        title: 'Source',
        source: 'WEB',
        url: 'https://example.test/source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath,
        frontmatter: {},
        plainText: 'This lossy field is never the canonical passage input.',
        sourceVersion: 1,
        sourceChecksum: 'canonical',
        sourceMetadata: {
          producer: 'voxen-capture',
          evidenceManifest: createSourceEvidenceManifest(body, [
            { start: summary.length, end: body.length },
          ]),
        },
      },
    });
  }
  test('uses exact canonical text and recorded spans rather than lossy text or heading names', async () => {
    const row = await document();
    const loaded = await loadPassageSource({ userId: users[0]!, type: 'transcript', id: row.id });
    expect(loaded.source.text).toBe(body);
    expect(loaded.limitations).toEqual([]);
    const passages = buildPassages(loaded.source).passages;
    expect(passages.map((p) => [p.kind, p.authority])).toEqual([
      ['SOURCE_DERIVED', null],
      ['ORIGINAL', 'CAPTURED_SOURCE'],
    ]);
    expect(passages[1]).toMatchObject({ text: original, startLine: 4, startSec: 12 });
  });
  test('maps source edits but never promotes an edited generated interpretation', async () => {
    const row = await document();
    const corrected = body
      .replace('A generated interpretation.', 'A modified generated interpretation.')
      .replace('Orion belongs to Vega.', 'Orion belongs to the corrected Vega project.');
    await db.transcript.update({
      where: { id: row.id },
      data: {
        correctedMarkdown: corrected,
        correctionRevision: 1,
      },
    });
    const loaded = await loadPassageSource({ userId: users[0]!, type: 'transcript', id: row.id });
    const passages = buildPassages(loaded.source).passages;
    expect(
      passages
        .filter((p) => p.kind === 'ORIGINAL')
        .map((p) => p.text)
        .join(''),
    ).toContain('corrected Vega');
    expect(passages.find((p) => p.text.includes('modified generated'))?.kind).toBe(
      'SOURCE_DERIVED',
    );
    expect(passages.some((p) => p.authority === 'USER_CORRECTED')).toBe(true);
  });
  test('keeps legacy or tampered provenance searchable only as explicitly unclassified derived context', async () => {
    const row = await document();
    for (const sourceMetadata of [
      {},
      { producer: 'voxen-capture' },
      {
        producer: 'voxen-capture',
        evidenceManifest: { version: 1, canonicalChecksum: '0'.repeat(64), spans: [] },
      },
    ]) {
      await db.transcript.update({ where: { id: row.id }, data: { sourceMetadata } });
      const loaded = await loadPassageSource({ userId: users[0]!, type: 'transcript', id: row.id });
      expect(loaded.limitations).toEqual(['PROVENANCE_UNAVAILABLE']);
      expect(
        buildPassages(loaded.source).passages.every(
          (p) => p.kind === 'SOURCE_DERIVED' && p.authority === null,
        ),
      ).toBe(true);
    }
  });
  test('rejects foreign, missing, archived sources and unavailable canonical objects without inventing fallback text', async () => {
    const foreign = await document(users[1]);
    const archived = await document();
    await db.transcript.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });
    for (const id of [foreign.id, archived.id, randomUUID()])
      await expect(
        loadPassageSource({ userId: users[0]!, type: 'transcript', id }),
      ).rejects.toThrow('NOT_FOUND');
    const missingObject = await document();
    await db.transcript.update({
      where: { id: missingObject.id },
      data: { mdPath: 'not-available.md' },
    });
    await expect(
      loadPassageSource({ userId: users[0]!, type: 'transcript', id: missingObject.id }),
    ).rejects.toThrow('UNAVAILABLE_SOURCE');
  });
  test('reads notes as their own original text with a revision identity that changes after editing', async () => {
    const row = await db.note.create({
      data: { userId: users[0]!, title: 'Curated note', content: body },
    });
    const identity = { userId: users[0]!, type: 'note' as const, id: row.id };
    const first = await loadPassageSource(identity);
    expect(first.source.regions).toEqual([
      { start: 0, end: body.length, kind: 'ORIGINAL', authority: null },
    ]);
    await db.note.update({
      where: { id: row.id },
      data: { content: body + 'An amendment.', revision: 2 },
    });
    expect((await loadPassageSource(identity)).source.revision).not.toBe(first.source.revision);
    await expect(loadPassageSource({ ...identity, userId: users[1]! })).rejects.toThrow(
      'NOT_FOUND',
    );
    await db.note.update({ where: { id: row.id }, data: { kind: 'FOLDER' } });
    await expect(loadPassageSource(identity)).rejects.toThrow('NOT_FOUND');
  });
  test('indexes only current accepted external context and retains its separate source identity', async () => {
    const row = await document();
    const enrichment = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: row.id,
        runKey: randomUUID(),
        trigger: 'MANUAL',
        status: 'READY',
        reviewState: 'ACCEPTED',
        title: 'External context',
        content: original,
        sourceVersion: row.sourceVersion,
        sourceChecksum: row.sourceChecksum,
      },
    });
    const identity = { userId: users[0]!, type: 'external_enrichment' as const, id: enrichment.id };
    const loaded = await loadPassageSource(identity);
    expect(loaded.source.regions).toEqual([
      { start: 0, end: original.length, kind: 'EXTERNAL_ACCEPTED', authority: null },
    ]);
    for (const data of [
      { reviewState: 'SUGGESTED' as const },
      { staleReason: 'SOURCE_CHANGED' },
      { expiresAt: new Date(0) },
      { sourceVersion: 0 },
      { sourceChecksum: 'different' },
    ]) {
      await db.transcriptEnrichment.update({ where: { id: enrichment.id }, data });
      await expect(loadPassageSource(identity)).rejects.toThrow('NOT_FOUND');
      await db.transcriptEnrichment.update({
        where: { id: enrichment.id },
        data: {
          reviewState: 'ACCEPTED',
          staleReason: null,
          expiresAt: null,
          sourceVersion: row.sourceVersion,
          sourceChecksum: row.sourceChecksum,
        },
      });
    }
    await db.transcript.update({ where: { id: row.id }, data: { status: 'ARCHIVED' } });
    await expect(loadPassageSource(identity)).rejects.toThrow('NOT_FOUND');
  });
});
