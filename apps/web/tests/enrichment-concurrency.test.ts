import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import {
  enrichmentProjectionWork,
  repairEnrichmentProjection,
} from '../src/lib/enrichment-projection';
import { filterAccessibleBrainNodes } from '../src/lib/brain-source-visibility';
import { db } from '../src/lib/db';
import { enrichmentChecksum, enrichmentContract } from '../src/lib/enrichment-contract';
import { EnrichmentCommandError, mutateEnrichment } from '../src/lib/enrichment-commands';

describe.skipIf(!process.env.DATABASE_URL)('canonical enrichment concurrency', () => {
  let userId = '';
  const restores: Array<() => void> = [];
  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
  });
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          name: 'Concurrency QA',
          email: `enrichment-cas-${crypto.randomUUID()}@example.test`,
          status: 'APPROVED',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
  });
  async function fixture(status: 'READY' | 'RUNNING' = 'READY') {
    const parent = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: `https://example.test/${crypto.randomUUID()}`,
        title: 'Owned source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'qa/enrichment.md',
        plainText: 'Original evidence',
        frontmatter: {},
      },
    });
    const row = await db.transcriptEnrichment.create({
      data: {
        userId,
        transcriptId: parent.id,
        runKey: crypto.randomUUID(),
        trigger: 'MANUAL',
        status,
        title: 'Original',
        content: 'Original evidence',
        sourceVersion: parent.sourceVersion,
        sourceChecksum: parent.sourceChecksum,
        citations: [
          { url: 'https://example.test/source', title: 'Source', excerpt: 'Original evidence' },
        ],
      },
    });
    return {
      row,
      parent,
      preconditions: {
        userId,
        enrichmentId: row.id,
        expectedRevision: row.revision,
        expectedChecksum: enrichmentChecksum(row, parent),
      },
    };
  }
  test('concurrent edits apply exactly one observed revision and preserve citations', async () => {
    const f = await fixture();
    const results = await Promise.allSettled(
      ['First', 'Second'].map((title) =>
        mutateEnrichment({
          ...f.preconditions,
          action: 'edit',
          title,
          content: 'Updated evidence',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(EnrichmentCommandError);
    expect(rejected.reason.code).toBe('CONFLICT');
    const after = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(after.revision).toBe(2);
    expect(after.brainProjectionPending).toBe(true);
    expect(after.citations).toEqual(f.row.citations);
    expect(enrichmentContract(after, f.parent).projection.state).toBe('PENDING');
  });
  test('checksum detects a worker edit without consuming a manual revision', async () => {
    const f = await fixture();
    await db.transcriptEnrichment.update({
      where: { id: f.row.id },
      data: { title: 'Worker update' },
    });
    await expect(
      mutateEnrichment({
        ...f.preconditions,
        action: 'edit',
        title: 'Unseen overwrite',
        content: 'bad',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(after.title).toBe('Worker update');
    expect(after.revision).toBe(1);
    expect(after.brainProjectionPending).toBe(false);
  });
  test('freshness and inactive parent acceptance are checked against the locked current parent', async () => {
    const f = await fixture();
    let parent = await db.transcript.update({
      where: { id: f.parent.id },
      data: { status: 'ARCHIVED' },
    });
    await expect(
      mutateEnrichment({
        ...f.preconditions,
        expectedChecksum: enrichmentChecksum(f.row, parent),
        action: 'accept',
      }),
    ).rejects.toMatchObject({ code: 'INACTIVE' });
    parent = await db.transcript.update({
      where: { id: f.parent.id },
      data: { status: 'ACTIVE', sourceVersion: { increment: 1 }, sourceChecksum: 'changed' },
    });
    await expect(
      mutateEnrichment({
        ...f.preconditions,
        expectedChecksum: enrichmentChecksum(f.row, parent),
        action: 'accept',
      }),
    ).rejects.toMatchObject({ code: 'STALE' });
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } })).reviewState,
    ).toBe('SUGGESTED');
  });
  test('completed publication rejects an old cancellation without a cancellation flag', async () => {
    const f = await fixture('RUNNING');
    await db.transcriptEnrichment.update({
      where: { id: f.row.id },
      data: { status: 'READY', content: 'Published' },
    });
    await expect(mutateEnrichment({ ...f.preconditions, action: 'cancel' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } }))
        .cancelRequestedAt,
    ).toBeNull();
  });
  test('checksums are stable across adapter parent selections and foreign owners are rejected', async () => {
    const f = await fixture();
    expect(
      enrichmentChecksum(f.row, {
        status: f.parent.status,
        sourceChecksum: f.parent.sourceChecksum,
        sourceVersion: f.parent.sourceVersion,
      }),
    ).toBe(f.preconditions.expectedChecksum);
    await expect(
      mutateEnrichment({ ...f.preconditions, userId: 'foreign-owner', action: 'dismiss' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  test('a projection failure leaves the committed content pending and repairs after restart', async () => {
    const f = await fixture();
    const accepted = (await mutateEnrichment({ ...f.preconditions, action: 'accept' })).enrichment;
    const failure = spyOn(enrichmentProjectionWork, 'materialize').mockRejectedValue(
      new Error('secret-database-path'),
    );
    restores.push(() => failure.mockRestore());
    expect(await repairEnrichmentProjection(userId, accepted.id)).toBe(false);
    let current = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(current.reviewState).toBe('ACCEPTED');
    expect(current.brainProjectionErrorCode).toBe('GRAPH_PROJECTION_RETRY');
    expect(current.brainProjectionPending).toBe(true);
    expect(current.updatedAt).toEqual(accepted.updatedAt);
    failure.mockRestore();
    await db.$executeRaw`UPDATE "TranscriptEnrichment" SET "brainProjectionNextAttemptAt"=NULL WHERE id=${accepted.id}`;
    expect(await repairEnrichmentProjection(userId, accepted.id)).toBe(true);
    current = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(current.brainProjectionPending).toBe(false);
    expect(current.brainProjectedRevision).toBe(accepted.revision);
    expect(current.brainProjectionErrorCode).toBeNull();
    expect(current.updatedAt).toEqual(accepted.updatedAt);
    const nodes = await db.brainNode.findMany({ where: { userId, sourceId: accepted.id } });
    expect(await filterAccessibleBrainNodes(userId, nodes)).toHaveLength(1);
    await db.brainNode.update({
      where: { id: nodes[0]!.id },
      data: { metadata: { enrichmentRevision: 1 } },
    });
    const oldNodes = await db.brainNode.findMany({ where: { userId, sourceId: accepted.id } });
    expect(await filterAccessibleBrainNodes(userId, oldNodes)).toHaveLength(0);
  });
  test('a busy graph lease never acknowledges work which did not run', async () => {
    const f = await fixture();
    await mutateEnrichment({ ...f.preconditions, action: 'accept' });
    const busy = spyOn(enrichmentProjectionWork, 'withLease').mockResolvedValue(false);
    restores.push(() => busy.mockRestore());
    expect(await repairEnrichmentProjection(userId, f.row.id)).toBe(false);
    const after = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(after.brainProjectionPending).toBe(true);
    expect(after.brainProjectionAttempt).toBe(0);
  });
  test('an edit arriving during materialization prevents an obsolete acknowledgement', async () => {
    const f = await fixture();
    const accepted = (await mutateEnrichment({ ...f.preconditions, action: 'accept' })).enrichment;
    const original = enrichmentProjectionWork.materialize;
    const late = spyOn(enrichmentProjectionWork, 'materialize').mockImplementation(
      async (owner, id, guard) => {
        await original(owner, id, guard);
        await mutateEnrichment({
          userId,
          enrichmentId: id,
          expectedRevision: accepted.revision,
          expectedChecksum: enrichmentChecksum(accepted, f.parent),
          action: 'edit',
          title: 'Newer',
          content: 'Newer evidence',
        });
      },
    );
    restores.push(() => late.mockRestore());
    expect(await repairEnrichmentProjection(userId, f.row.id)).toBe(false);
    const pending = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } });
    expect(pending.revision).toBe(3);
    expect(pending.brainProjectionPending).toBe(true);
    expect(
      await filterAccessibleBrainNodes(
        userId,
        await db.brainNode.findMany({ where: { userId, sourceId: f.row.id } }),
      ),
    ).toHaveLength(0);
    late.mockRestore();
    expect(await repairEnrichmentProjection(userId, f.row.id)).toBe(true);
    const node = await db.brainNode.findFirstOrThrow({ where: { userId, sourceId: f.row.id } });
    expect(node.label).toBe('Newer');
    expect(await filterAccessibleBrainNodes(userId, [node])).toHaveLength(1);
    const synced = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } });
    const dismissed = (
      await mutateEnrichment({
        userId,
        enrichmentId: synced.id,
        expectedRevision: synced.revision,
        expectedChecksum: enrichmentChecksum(synced, f.parent),
        action: 'dismiss',
      })
    ).enrichment;
    expect(await repairEnrichmentProjection(userId, dismissed.id)).toBe(true);
    expect(await db.brainNode.count({ where: { userId, sourceId: dismissed.id } })).toBe(0);
  });
  test('current cancellation commits a revision and repair removes its derivatives', async () => {
    const f = await fixture('RUNNING');
    const cancelled = (await mutateEnrichment({ ...f.preconditions, action: 'cancel' })).enrichment;
    expect(cancelled.cancelRequestedAt).not.toBeNull();
    expect(cancelled.status).toBe('RUNNING');
    expect(cancelled.revision).toBe(2);
    expect(cancelled.brainProjectionPending).toBe(true);
    expect(await repairEnrichmentProjection(userId, cancelled.id)).toBe(true);
  });
  test('lease loss immediately before acknowledgement retains pending work', async () => {
    const f = await fixture();
    await mutateEnrichment({ ...f.preconditions, action: 'accept' });
    const lost = spyOn(enrichmentProjectionWork, 'withLease').mockImplementation(
      async (_owner, operation) => {
        let calls = 0;
        await operation(async () => {
          if (++calls >= 3) throw new Error('Lease lost');
        });
        return true;
      },
    );
    const materialize = spyOn(enrichmentProjectionWork, 'materialize').mockResolvedValue(undefined);
    restores.push(
      () => lost.mockRestore(),
      () => materialize.mockRestore(),
    );
    expect(await repairEnrichmentProjection(userId, f.row.id)).toBe(false);
    expect(
      (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: f.row.id } }))
        .brainProjectionPending,
    ).toBe(true);
  });
});
