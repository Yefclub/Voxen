import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { getRedisPublisher } from '../src/lib/redis';
import { graphCacheKey, invalidateGraphCache } from '../src/lib/graph-cache';
import { readCurrentGraphCache } from '../src/lib/graph-cached-read';
import { readGraphSlice } from '../src/lib/graph-read-model';
import { enqueueKnowledgeDeletion } from '../src/lib/knowledge-deletion';
import { runKnowledgeDeletionJob } from '../src/lib/knowledge-deletion-executor';
import { enqueueOrganization } from '../src/lib/organization/queue';
import { claimOrganization } from '../src/lib/organization/lease';
import { saveOrganizationPreferences } from '../src/lib/organization/preferences';
import {
  executeOrganization,
  type OrganizationRunnerDependencies,
} from '../src/lib/organization/runner';

const root = mkdtempSync(join(tmpdir(), 'voxen-organization-lifecycle-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
const users: string[] = [];
const quote = 'Orion is explicitly part of the Vega product family.';
const deps: OrganizationRunnerDependencies = {
  prepare: async () => ({
    execution: {
      language: 'en',
      reasoning: 'off',
      chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
    },
    generate: async (input) => ({
      output: input.schema.parse({
        reason: 'An explicit relationship.',
        nodes: [
          { id: 'orion', name: 'Orion', kind: 'PRODUCT', quote },
          { id: 'vega', name: 'Vega', kind: 'PRODUCT', quote },
        ],
        relationships: [{ from: 'orion', to: 'vega', kind: 'PART_OF', quote }],
      }),
      modelRef: 'fixture:standard',
      costUsd: 0.0002,
      usage: { inputTokens: 80, outputTokens: 40 },
    }),
  }),
};

suite('organization source lifecycle and current graph visibility', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `organization-lifecycle-${randomUUID()}@example.test`,
              name: 'Organization lifecycle',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.user.updateMany({ where: { id: { in: users } }, data: { status: 'APPROVED' } });
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
    await db.brainSource.deleteMany({ where: { userId: { in: users } } });
    await db.brainNode.deleteMany({ where: { userId: { in: users } } });
    await db.setting.deleteMany({ where: { userId: { in: users }, scope: 'USER' } });
    for (const userId of users) await invalidateGraphCache(userId);
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
    rmSync(root, { recursive: true, force: true });
  });
  async function queued(userId = users[0]!) {
    await saveOrganizationPreferences(userId, 'MANUAL');
    const id = randomUUID(),
      mdPath = `workspaces/${userId}/transcripts/${id}/sources/v1.md`;
    await storagePut({ key: mdPath, body: quote, contentType: 'text/markdown' });
    const source = await db.transcript.create({
      data: {
        id,
        userId,
        title: 'Lifecycle source',
        source: 'WEB',
        url: `https://example.test/${id}`,
        language: 'en',
        durationSec: 0,
        transcriptionMethod: 'SCRAPE',
        mdPath,
        plainText: quote,
        summaryMd: 'Original summary.',
        sourceVersion: 1,
        sourceChecksum: 'original-sum',
        frontmatter: {},
      },
    });
    const run = (await enqueueOrganization(userId, id, 'MANUAL', randomUUID()))!;
    return { source, run };
  }
  async function published() {
    const f = await queued();
    expect(await executeOrganization(users[0]!, f.run.id, deps)).toBe(true);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED' });
    return f;
  }
  async function interrupted() {
    const f = await queued();
    expect(await claimOrganization(users[0]!, f.run.id)).not.toBeNull();
    await db.organizationSection.updateMany({
      where: { runId: f.run.id, run: { userId: users[0] } },
      data: { status: 'RUNNING', callPending: true, attempts: 1 },
    });
    return f;
  }
  test('source changes immediately cancel interrupted calls and preserve foreign work', async () => {
    const f = await interrupted(),
      foreign = await queued(users[1]);
    await db.transcript.update({
      where: { id: f.source.id },
      data: { sourceVersion: 2, sourceChecksum: 'new-source' },
    });
    const run = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
    });
    expect(run).toMatchObject({
      status: 'CANCELLED',
      lastError: 'SOURCE_CHANGED',
      costUsd: null,
      leaseOwner: null,
    });
    expect(run.warnings).toContain('UNCONFIRMED_USAGE');
    expect(
      await db.organizationRun.findFirstOrThrow({
        where: { id: foreign.run.id, userId: users[1] },
      }),
    ).toMatchObject({ status: 'PENDING' });
  });
  test('invalidates only changed-source evidence and retains shared relationships and manual organization', async () => {
    const one = await published(),
      two = await published();
    const edge = await db.brainEdge.findFirstOrThrow({
      where: { userId: users[0], kind: 'PART_OF', method: 'llm-grounded-organization' },
    });
    const manual = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'TOPIC:manual',
        type: 'TOPIC',
        label: 'My manual topic',
        metadata: { method: 'manual' },
      },
    });
    const manualEdge = await db.brainEdge.create({
      data: {
        userId: users[0]!,
        fromNodeId: manual.id,
        toNodeId: edge.fromNodeId,
        kind: 'RELATED_TO',
        method: 'manual',
      },
    });
    await db.transcript.update({
      where: { id: one.source.id },
      data: {
        correctionRevision: 1,
        correctedMarkdown: 'A user correction.',
        correctedChecksum: 'corrected',
      },
    });
    expect(
      await db.brainSource.count({
        where: { userId: users[0], sourceId: one.source.id, invalidatedAt: null },
      }),
    ).toBe(0);
    expect(
      await db.brainSource.count({
        where: { userId: users[0], sourceId: two.source.id, invalidatedAt: null },
      }),
    ).toBe(3);
    expect(
      await db.brainEdge.findFirstOrThrow({ where: { id: edge.id, userId: users[0] } }),
    ).toMatchObject({ status: 'ACTIVE' });
    await db.transcript.update({
      where: { id: two.source.id },
      data: { title: 'Changed source title' },
    });
    expect(
      await db.brainEdge.findFirstOrThrow({ where: { id: edge.id, userId: users[0] } }),
    ).toMatchObject({ status: 'ARCHIVED' });
    expect(
      await db.brainNode.findFirstOrThrow({ where: { id: manual.id, userId: users[0] } }),
    ).toEqual(manual);
    expect(
      await db.brainEdge.findFirstOrThrow({ where: { id: manualEdge.id, userId: users[0] } }),
    ).toEqual(manualEdge);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: one.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED', completedSections: 1 });
  });
  test('concurrent changes to both supporting sources cannot retain an unsupported active relationship', async () => {
    const one = await published(),
      two = await published();
    await Promise.all(
      [one, two].map((f) =>
        db.transcript.update({
          where: { id: f.source.id },
          data: { sourceVersion: 2, sourceChecksum: 'changed' },
        }),
      ),
    );
    expect(await db.brainSource.count({ where: { userId: users[0], invalidatedAt: null } })).toBe(
      0,
    );
    expect(
      await db.brainEdge.count({
        where: { userId: users[0], method: 'llm-grounded-organization', status: 'ACTIVE' },
      }),
    ).toBe(0);
  });
  test('archive and restore hide and recover unchanged evidence while rejecting stale graph caches', async () => {
    const f = await published();
    const key = `${graphCacheKey(users[0]!)}:lifecycle`;
    const value = JSON.stringify(
      await readGraphSlice({ userId: users[0]!, view: 'full', hops: 2 }),
    );
    await getRedisPublisher().set(key, value, 'EX', 60);
    expect(await readCurrentGraphCache(users[0]!, key)).toBe(value);
    await db.transcript.update({ where: { id: f.source.id }, data: { status: 'ARCHIVED' } });
    expect(
      await db.brainEdge.count({
        where: { userId: users[0], method: 'llm-grounded-organization', status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await db.brainSource.count({
        where: { userId: users[0], sourceId: f.source.id, invalidatedAt: null },
      }),
    ).toBe(3);
    expect(await readCurrentGraphCache(users[0]!, key)).toBeNull();
    await db.transcript.update({ where: { id: f.source.id }, data: { status: 'ACTIVE' } });
    expect(
      await db.brainEdge.count({
        where: { userId: users[0], method: 'llm-grounded-organization', status: 'ACTIVE' },
      }),
    ).toBe(3);
    expect(await readCurrentGraphCache(users[0]!, key)).toBe(value);
  });
  test('disabling an owner fences only that owner and reconciles unconfirmed cost', async () => {
    const f = await interrupted(),
      foreign = await queued(users[1]);
    await db.user.update({ where: { id: users[0] }, data: { status: 'DISABLED' } });
    const run = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
    });
    expect(run).toMatchObject({
      status: 'CANCELLED',
      lastError: 'PARENT_INACTIVE',
      costUsd: null,
      leaseOwner: null,
    });
    expect(run.warnings).toContain('UNCONFIRMED_USAGE');
    expect(
      await db.organizationRun.findFirstOrThrow({
        where: { id: foreign.run.id, userId: users[1] },
      }),
    ).toMatchObject({ status: 'PENDING' });
  });
  test('fresh verified evidence reuses identities archived by an obsolete source revision', async () => {
    const f = await published();
    const before = await db.brainNode.findMany({
      where: { userId: users[0], type: 'ENTITY', sourceType: null },
      orderBy: { id: 'asc' },
    });
    await db.transcript.update({
      where: { id: f.source.id },
      data: {
        correctionRevision: 1,
        correctedMarkdown: `${quote}\nA correction to the source.`,
        correctedChecksum: 'corrected',
      },
    });
    expect(
      await db.brainNode.count({
        where: { userId: users[0], type: 'ENTITY', sourceType: null, status: 'ACTIVE' },
      }),
    ).toBe(0);
    const run = (await enqueueOrganization(users[0]!, f.source.id, 'MANUAL', randomUUID()))!;
    await executeOrganization(users[0]!, run.id, deps);
    const after = await db.brainNode.findMany({
      where: { userId: users[0], type: 'ENTITY', sourceType: null, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    expect(after.map((node) => node.id)).toEqual(before.map((node) => node.id));
    expect(
      await db.brainEdge.count({
        where: {
          userId: users[0],
          kind: 'PART_OF',
          method: 'llm-grounded-organization',
          status: 'ACTIVE',
        },
      }),
    ).toBe(1);
    expect(
      await db.brainSource.count({
        where: {
          userId: users[0],
          sourceId: f.source.id,
          invalidatedAt: null,
          authority: 'USER_CORRECTED',
        },
      }),
    ).toBe(3);
  });
  test('republishing a source that returns to its original title restores current evidence', async () => {
    const f = await published();
    const evidence = await db.brainSource.findMany({
      where: { userId: users[0], sourceId: f.source.id },
      orderBy: { id: 'asc' },
    });
    const edgeIds = evidence.flatMap((row) => (row.edgeId ? [row.edgeId] : [])).sort();
    expect(edgeIds).toHaveLength(3);
    await db.transcript.update({ where: { id: f.source.id }, data: { title: 'Title B' } });
    await db.transcript.update({ where: { id: f.source.id }, data: { title: f.source.title } });
    expect(
      await db.brainSource.count({
        where: { userId: users[0], sourceId: f.source.id, invalidatedAt: null },
      }),
    ).toBe(0);
    const run = (await enqueueOrganization(users[0]!, f.source.id, 'MANUAL', randomUUID()))!;
    await executeOrganization(users[0]!, run.id, deps);
    const current = await db.brainSource.findMany({
      where: { userId: users[0], sourceId: f.source.id, invalidatedAt: null },
      orderBy: { id: 'asc' },
    });
    expect(current.map((row) => row.id)).toEqual(evidence.map((row) => row.id));
    for (const status of ['ARCHIVED', 'ACTIVE'] as const) {
      await db.transcript.update({ where: { id: f.source.id }, data: { status } });
      const edges = await db.brainEdge.findMany({
        where: { userId: users[0], method: 'llm-grounded-organization', status },
      });
      expect(edges.map((row) => row.id).sort()).toEqual(edgeIds);
    }
    expect(
      await db.organizationRun.findFirstOrThrow({
        where: { id: run.id, userId: users[0] },
      }),
    ).toMatchObject({ status: 'COMPLETED', completedSections: 1 });
  });
  test('fresh organization restores lifecycle-archived alias identities and their relationships', async () => {
    const f = await queued(),
      aliasSource = await queued();
    const identity = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:product:canonical-orion',
        type: 'ENTITY',
        label: 'Orion Project',
        description: 'Preserve the canonical identity.',
        metadata: { method: 'llm-grounded', entityType: 'PRODUCT' },
      },
    });
    await db.brainEntityAlias.create({
      data: {
        userId: users[0]!,
        entityNodeId: identity.id,
        alias: 'Orion',
        normalizedAlias: 'orion',
        entityType: 'PRODUCT',
        sourceType: 'TRANSCRIPT',
        sourceId: aliasSource.source.id,
        evidenceKey: randomUUID(),
      },
    });
    await executeOrganization(users[0]!, f.run.id, deps);
    const original = await db.brainEdge.findFirstOrThrow({
      where: { userId: users[0], kind: 'PART_OF', fromNodeId: identity.id },
    });
    const nodes = await db.brainNode.findMany({ where: { userId: users[0], type: 'ENTITY' } });
    await db.transcript.update({ where: { id: f.source.id }, data: { title: 'Revised title' } });
    expect(
      await db.brainNode.findFirstOrThrow({
        where: { id: identity.id, userId: users[0] },
      }),
    ).toMatchObject({ status: 'ARCHIVED', metadata: { organizationLifecycleArchived: true } });
    const run = (await enqueueOrganization(users[0]!, f.source.id, 'MANUAL', randomUUID()))!;
    await executeOrganization(users[0]!, run.id, deps);
    expect(
      await db.brainNode.findFirstOrThrow({
        where: { id: identity.id, userId: users[0] },
      }),
    ).toMatchObject({ status: 'ACTIVE', label: identity.label, description: identity.description });
    const current = await db.brainNode.findMany({ where: { userId: users[0], type: 'ENTITY' } });
    expect(current.map((row) => row.id).sort()).toEqual(nodes.map((row) => row.id).sort());
    expect(
      await db.brainEdge.findFirstOrThrow({
        where: { id: original.id, userId: users[0] },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(
      await db.brainSource.count({
        where: { userId: users[0], edgeId: original.id, invalidatedAt: null },
      }),
    ).toBe(1);
  });
  test('does not reactivate an identity archived by an explicit manual choice', async () => {
    const f = await published();
    const node = await db.brainNode.findFirstOrThrow({
      where: { userId: users[0], label: 'Orion', type: 'ENTITY' },
    });
    await db.brainNode.update({ where: { id: node.id }, data: { status: 'ARCHIVED' } });
    await db.transcript.update({
      where: { id: f.source.id },
      data: {
        correctionRevision: 1,
        correctedMarkdown: `${quote}\nAn updated source.`,
        correctedChecksum: 'corrected',
      },
    });
    const run = (await enqueueOrganization(users[0]!, f.source.id, 'MANUAL', randomUUID()))!;
    await executeOrganization(users[0]!, run.id, deps);
    expect(
      await db.brainNode.findFirstOrThrow({ where: { id: node.id, userId: users[0] } }),
    ).toMatchObject({ status: 'ARCHIVED', label: 'Orion' });
    expect(
      await db.brainEdge.count({
        where: {
          userId: users[0],
          kind: 'PART_OF',
          method: 'llm-grounded-organization',
          status: 'ACTIVE',
        },
      }),
    ).toBe(0);
  });
  test('does not reactivate an automatically generated relationship archived by a manual choice', async () => {
    const f = await published();
    const edge = await db.brainEdge.findFirstOrThrow({
      where: { userId: users[0], kind: 'PART_OF', method: 'llm-grounded-organization' },
    });
    await db.brainEdge.update({ where: { id: edge.id }, data: { status: 'ARCHIVED' } });
    await db.transcript.update({
      where: { id: f.source.id },
      data: {
        correctionRevision: 1,
        correctedMarkdown: `${quote}\nA user correction.`,
        correctedChecksum: 'corrected',
      },
    });
    const run = (await enqueueOrganization(users[0]!, f.source.id, 'MANUAL', randomUUID()))!;
    await executeOrganization(users[0]!, run.id, deps);
    expect(
      await db.brainEdge.findFirstOrThrow({ where: { id: edge.id, userId: users[0] } }),
    ).toMatchObject({ status: 'ARCHIVED' });
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED', warnings: ['INACTIVE_RELATIONSHIP'] });
  });
  test('actual deletion removes owned runs and keys while preserving another source and foreign evidence', async () => {
    const one = await published(),
      two = await published();
    await db.brainSource.create({
      data: {
        userId: users[1]!,
        sourceType: 'TRANSCRIPT',
        sourceId: one.source.id,
        excerpt: 'Foreign evidence must remain isolated.',
      },
    });
    await db.transcript.update({ where: { id: one.source.id }, data: { status: 'TRASH' } });
    const deletion = await enqueueKnowledgeDeletion({
      userId: users[0]!,
      type: 'TRANSCRIPT',
      id: one.source.id,
    });
    expect(await runKnowledgeDeletionJob(deletion.job.id)).toBe(true);
    expect(await runKnowledgeDeletionJob(deletion.job.id)).toBe(false);
    expect(
      await db.organizationRun.count({ where: { userId: users[0], transcriptId: one.source.id } }),
    ).toBe(0);
    expect(
      await db.organizationRequest.count({
        where: { userId: users[0], transcriptId: one.source.id },
      }),
    ).toBe(0);
    expect(await db.organizationSection.count({ where: { runId: one.run.id } })).toBe(0);
    expect(
      await db.brainSource.count({ where: { userId: users[1], sourceId: one.source.id } }),
    ).toBe(1);
    expect(
      await db.transcript.findFirstOrThrow({ where: { id: two.source.id, userId: users[0] } }),
    ).toEqual(two.source);
    expect(
      await db.brainEdge.count({
        where: {
          userId: users[0],
          kind: 'PART_OF',
          method: 'llm-grounded-organization',
          status: 'ACTIVE',
        },
      }),
    ).toBe(1);
  });
});
