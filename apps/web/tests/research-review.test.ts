import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { saveResearchPreferences } from '../src/lib/research/preferences';
import { enqueueResearch } from '../src/lib/research/queue';
import { listResearch, reviewResearch } from '../src/lib/research/review';
import { projectResearch } from '../src/lib/research/projection';
import { ftsSearchTranscriptEnrichments } from '../src/lib/retrieval-enrichments';
import { filterCurrentOwnedBrainSources } from '../src/lib/brain-source-visibility';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('external research review and projection lifecycle', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `research-review-${randomUUID()}@example.test`,
              name: 'Research review',
              status: 'APPROVED',
            },
          })
        ).id,
      );
    await saveResearchPreferences(users[0]!, 'MANUAL');
  });
  afterEach(async () => {
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
    await db.brainNode.deleteMany({ where: { userId: { in: users } } });
    await db.job.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function fixture() {
    const source = await db.transcript.create({
      data: {
        userId: users[0]!,
        source: 'WEB',
        url: 'https://example.com/original',
        title: 'Original document',
        plainText: 'The original source remains separate.',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'fixture.md',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'original',
      },
    });
    const queued = (await enqueueResearch(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    await db.transcriptEnrichment.update({
      where: { id: queued.id },
      data: {
        status: 'READY',
        title: 'External neutrino evidence',
        content: 'Neutrino telescopes collect signals from the sky.',
        rationale: 'Provides external context.',
        costUsd: 0.0006,
        citations: [
          {
            url: 'https://example.com/primary',
            title: 'Primary source',
            excerpt: 'Neutrino telescopes collect signals from the sky.',
            retrievedAt: '2026-11-13T20:00:00.000Z',
          },
        ],
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const [item] = (await listResearch(users[0]!, source.id)).enrichments;
    return { source, item: item! };
  }
  function guard(item: { revision: number; checksum: string }) {
    return { expectedRevision: item.revision, expectedChecksum: item.checksum };
  }
  test('exposes provenance and usage without making suggestions factual retrieval', async () => {
    const { source, item } = await fixture();
    expect(item.citations[0]).toMatchObject({ retrievedAt: '2026-11-13T20:00:00.000Z' });
    expect(item.costUsd).toBe(0.0006);
    expect(item).not.toHaveProperty('generationSettings');
    expect(item.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(await ftsSearchTranscriptEnrichments(users[0]!, 'neutrino', 8)).toEqual([]);
    expect((await db.transcript.findUniqueOrThrow({ where: { id: source.id } })).plainText).toBe(
      source.plainText,
    );
  });
  test('makes missing and foreign parents or results indistinguishable', async () => {
    const { source, item } = await fixture();
    for (const id of [source.id, 'missing'])
      await expect(listResearch(users[1]!, id)).rejects.toThrow('NOT_FOUND');
    for (const id of [item.id, 'missing'])
      await expect(
        reviewResearch(users[1]!, source.id, id, { action: 'accept', ...guard(item) }),
      ).rejects.toThrow('NOT_FOUND');
  });
  test('accepts into retrieval and projects the reviewed revision into graph evidence', async () => {
    const { source, item } = await fixture();
    const accepted = await reviewResearch(users[0]!, source.id, item.id, {
      action: 'accept',
      ...guard(item),
    });
    expect(accepted.projection.state).toBe('PENDING');
    expect((await ftsSearchTranscriptEnrichments(users[0]!, 'neutrino', 8))[0]?.id).toBe(item.id);
    await projectResearch(users[0]!, item.id);
    const references = [{ sourceType: 'EXTERNAL_ENRICHMENT' as const, sourceId: item.id }];
    expect(await filterCurrentOwnedBrainSources(users[0]!, references)).toEqual(references);
    expect((await listResearch(users[0]!, source.id)).enrichments[0]!.projection.state).toBe(
      'SYNCED',
    );
    expect(await db.brainNode.count({ where: { userId: users[0]!, sourceId: item.id } })).toBe(1);
  });
  test('rejects old review guards and identifies an edit as curated and unaccepted', async () => {
    const { source, item } = await fixture();
    const accepted = await reviewResearch(users[0]!, source.id, item.id, {
      action: 'accept',
      ...guard(item),
    });
    await expect(
      reviewResearch(users[0]!, source.id, item.id, {
        action: 'edit',
        title: 'Stale edit',
        content: 'An obsolete editor must not replace the result.',
        ...guard(item),
      }),
    ).rejects.toThrow('REVISION_CONFLICT');
    const edited = await reviewResearch(users[0]!, source.id, item.id, {
      action: 'edit',
      title: 'Curated context',
      content: 'Manually curated neutrino context.',
      ...guard(accepted),
    });
    expect(edited.reviewState).toBe('SUGGESTED');
    expect(edited.editedAt).not.toBeNull();
    expect(edited.citations).toEqual(item.citations);
    expect(await ftsSearchTranscriptEnrichments(users[0]!, 'neutrino', 8)).toEqual([]);
    expect(
      await filterCurrentOwnedBrainSources(users[0]!, [
        { sourceType: 'EXTERNAL_ENRICHMENT', sourceId: item.id },
      ]),
    ).toEqual([]);
  });
  test('retains a failed graph projection for retry with a safe diagnostic', async () => {
    const { source, item } = await fixture();
    await reviewResearch(users[0]!, source.id, item.id, { action: 'accept', ...guard(item) });
    const name = `research_projection_fault_${randomUUID().replaceAll('-', '')}`;
    expect(users[0]).toMatch(/^[a-z0-9]+$/);
    const log = spyOn(process.stderr, 'write').mockImplementation(() => true);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = TG_ARGV[0] THEN RAISE EXCEPTION 'private fixture projection details'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON "BrainNode" FOR EACH ROW EXECUTE FUNCTION ${name}('${users[0]}')`,
      );
      await projectResearch(users[0]!, item.id);
      expect(await db.transcriptEnrichment.findUnique({ where: { id: item.id } })).toMatchObject({
        brainProjectionPending: true,
        brainProjectionErrorCode: 'PROJECTION_FAILED',
        brainProjectionAttempt: 1,
      });
      expect(JSON.stringify(log.mock.calls)).toContain('RESEARCH_PROJECTION_FAILED');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private fixture projection details');
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "BrainNode"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
      log.mockRestore();
    }
    await projectResearch(users[0]!, item.id);
    expect((await listResearch(users[0]!, source.id)).enrichments[0]!.projection.state).toBe(
      'SYNCED',
    );
  });
  test('cannot accept changed or expired evidence, and supersedes earlier accepted context atomically', async () => {
    const { source, item } = await fixture();
    await reviewResearch(users[0]!, source.id, item.id, { action: 'accept', ...guard(item) });
    const next = (await enqueueResearch(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    await db.transcriptEnrichment.update({
      where: { id: next.id },
      data: {
        status: 'READY',
        title: 'New context',
        content: 'A new external result.',
        citations: item.citations,
      },
    });
    const latest = (await listResearch(users[0]!, source.id)).enrichments.find(
      (row) => row.id === next.id,
    )!;
    await reviewResearch(users[0]!, source.id, latest.id, { action: 'accept', ...guard(latest) });
    expect(
      await db.transcriptEnrichment.count({
        where: { transcriptId: source.id, reviewState: 'ACCEPTED' },
      }),
    ).toBe(1);
    await db.transcript.update({
      where: { id: source.id },
      data: { plainText: 'Corrected original.' },
    });
    const stale = (await listResearch(users[0]!, source.id)).enrichments.find(
      (row) => row.id === next.id,
    )!;
    await expect(
      reviewResearch(users[0]!, source.id, next.id, { action: 'accept', ...guard(stale) }),
    ).rejects.toThrow('STALE_RESULT');
    expect(await ftsSearchTranscriptEnrichments(users[0]!, 'neutrino', 8)).toEqual([]);
  });
  test('rejects expired and citation-free results even before a list refresh', async () => {
    const { source, item } = await fixture();
    await db.transcriptEnrichment.update({
      where: { id: item.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      reviewResearch(users[0]!, source.id, item.id, { action: 'accept', ...guard(item) }),
    ).rejects.toThrow('REVISION_CONFLICT');
    const stale = (await listResearch(users[0]!, source.id)).enrichments[0]!;
    expect(stale.staleReason).toBe('research-expired');
    await expect(
      reviewResearch(users[0]!, source.id, item.id, { action: 'accept', ...guard(stale) }),
    ).rejects.toThrow('STALE_RESULT');
    await db.transcriptEnrichment.update({
      where: { id: item.id },
      data: { expiresAt: null, staleReason: null, citations: [] },
    });
    const unsupported = (await listResearch(users[0]!, source.id)).enrichments[0]!;
    await expect(
      reviewResearch(users[0]!, source.id, item.id, { action: 'accept', ...guard(unsupported) }),
    ).rejects.toThrow('UNGROUNDED_RESULT');
  });
  test('cancels unfinished work and removes deleted context from retrieval before execution', async () => {
    const { source, item } = await fixture();
    const accepted = await reviewResearch(users[0]!, source.id, item.id, {
      action: 'accept',
      ...guard(item),
    });
    const deleting = await reviewResearch(users[0]!, source.id, item.id, {
      action: 'delete',
      ...guard(accepted),
    });
    expect(deleting.deletionPending).toBe(true);
    expect(
      await db.job.count({
        where: { userId: users[0]!, type: 'DELETE_KNOWLEDGE', deletionTargetId: item.id },
      }),
    ).toBe(1);
    expect(await ftsSearchTranscriptEnrichments(users[0]!, 'neutrino', 8)).toEqual([]);
    await expect(
      reviewResearch(users[0]!, source.id, item.id, { action: 'accept', ...guard(deleting) }),
    ).rejects.toThrow('DELETION_PENDING');
    const pending = (await enqueueResearch(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    const current = (await listResearch(users[0]!, source.id)).enrichments.find(
      (row) => row.id === pending.id,
    )!;
    const cancelled = await reviewResearch(users[0]!, source.id, pending.id, {
      action: 'cancel',
      ...guard(current),
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(await db.transcriptEnrichment.findUnique({ where: { id: pending.id } })).toMatchObject({
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });
});
