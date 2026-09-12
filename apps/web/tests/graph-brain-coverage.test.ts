import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readBrainCoverage } from '../src/lib/graph-brain-coverage';
import { db } from '../src/lib/db';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('graph semantic coverage (database)', () => {
  let ownerId = '';
  let otherId = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const [owner, other] = await Promise.all([
      db.user.create({
        data: {
          email: `graph-coverage-owner-${suffix}@voxen.local`,
          name: 'Coverage owner',
          status: 'APPROVED',
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          email: `graph-coverage-other-${suffix}@voxen.local`,
          name: 'Coverage other',
          status: 'APPROVED',
        },
        select: { id: true },
      }),
    ]);
    ownerId = owner.id;
    otherId = other.id;

    const [ownerTranscript, otherTranscript] = await Promise.all([
      db.transcript.create({
        data: {
          userId: ownerId,
          source: 'WEB',
          url: `https://example.test/${suffix}/owner`,
          title: 'Owner source',
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${ownerId}/coverage.md`,
          plainText: 'owner semantic coverage',
          frontmatter: {},
        },
        select: { id: true },
      }),
      db.transcript.create({
        data: {
          userId: otherId,
          source: 'WEB',
          url: `https://example.test/${suffix}/other`,
          title: 'Other source',
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${otherId}/coverage.md`,
          plainText: 'other semantic coverage',
          frontmatter: {},
        },
        select: { id: true },
      }),
    ]);

    await db.brainCompilation.create({
      data: {
        userId: ownerId,
        transcriptId: ownerTranscript.id,
        contentHash: 'owner-hash',
        totalSegments: 7,
        completedSegments: 1,
        segments: {
          create: [
            { segmentKey: 'pending', status: 'PENDING', startLine: 1, endLine: 1 },
            { segmentKey: 'running', status: 'RUNNING', startLine: 2, endLine: 2 },
            { segmentKey: 'retry', status: 'RETRY', startLine: 3, endLine: 3 },
            { segmentKey: 'completed', status: 'COMPLETED', startLine: 4, endLine: 4 },
            { segmentKey: 'failed', status: 'FAILED', startLine: 5, endLine: 5 },
            { segmentKey: 'skipped', status: 'SKIPPED', startLine: 6, endLine: 6 },
            { segmentKey: 'pending-2', status: 'PENDING', startLine: 7, endLine: 7 },
          ],
        },
      },
    });
    await db.brainCompilation.create({
      data: {
        userId: otherId,
        transcriptId: otherTranscript.id,
        contentHash: 'other-hash',
        totalSegments: 1,
        segments: {
          create: [{ segmentKey: 'other', status: 'FAILED', startLine: 1, endLine: 1 }],
        },
      },
    });
  });

  afterAll(async () => {
    if (ownerId && otherId) {
      await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    }
  });

  it('reports each durable state without leaking another workspace', async () => {
    const coverage = await readBrainCoverage(ownerId);

    expect(coverage).toMatchObject({
      expectedSourceNodes: 1,
      indexedSourceNodes: 0,
      staleSourceNodes: 0,
      semantic: {
        total: 7,
        pending: 2,
        running: 1,
        retrying: 1,
        completed: 1,
        failed: 1,
        skipped: 1,
      },
    });
  });
});
