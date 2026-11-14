import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '../src/lib/db';
import { AiError } from '../src/lib/ai/errors';
import { storagePut } from '../src/lib/storage';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';
import { OrganizationAnalysisSchema } from '../src/lib/organization/generate';
import { acquireGraphIndexLease, releaseGraphIndexLease } from '../src/lib/graph-index-coordinator';
import { enqueueOrganization } from '../src/lib/organization/queue';
import { claimOrganization } from '../src/lib/organization/lease';
import { saveOrganizationPreferences } from '../src/lib/organization/preferences';
import {
  executeOrganization,
  type OrganizationRunnerDependencies,
} from '../src/lib/organization/runner';
import type { OrganizationExecution } from '../src/lib/organization/context';

const root = mkdtempSync(join(tmpdir(), 'voxen-organization-runner-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
const users: string[] = [];
const quote = 'Orion is part of the Vega project and documents its release process.';
suite('durable source-grounded organization execution', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `organization-runner-${randomUUID()}@example.test`,
              name: 'Organization execution',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
    await db.brainNode.deleteMany({ where: { userId: { in: users } } });
    await db.setting.deleteMany({ where: { userId: { in: users }, scope: 'USER' } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
    rmSync(root, { recursive: true, force: true });
  });
  async function queued(text = quote, userId = users[0]!, capturedWithoutEvidence = false) {
    await saveOrganizationPreferences(userId, 'MANUAL');
    const id = randomUUID(),
      mdPath = `workspaces/${userId}/transcripts/${id}/source.md`;
    await storagePut({ key: mdPath, body: text, contentType: 'text/markdown' });
    const source = await db.transcript.create({
      data: {
        id,
        userId,
        title: 'Original source',
        source: 'WEB',
        url: `https://example.test/${id}`,
        language: 'en',
        durationSec: 0,
        transcriptionMethod: 'SCRAPE',
        frontmatter: {},
        mdPath,
        plainText: text,
        summaryMd: 'Original summary.',
        sourceVersion: 1,
        sourceChecksum: 'original-sum',
        sourceMetadata: capturedWithoutEvidence
          ? { producer: 'voxen-capture', evidenceManifest: createSourceEvidenceManifest(text, []) }
          : {},
      },
    });
    return { source, run: (await enqueueOrganization(userId, id, 'MANUAL', randomUUID()))! };
  }
  function dependencies(
    options: { failAt?: number; alwaysFail?: boolean; beforeResult?: () => Promise<void> } = {},
  ) {
    const calls: string[] = [];
    const snapshots: Array<OrganizationExecution | null> = [];
    const deps: OrganizationRunnerDependencies = {
      prepare: async (_userId, saved) => {
        snapshots.push(saved);
        return {
          execution: saved ?? {
            language: 'en',
            reasoning: 'off',
            chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
          },
          generate: async (input) => {
            const part = input.untrusted[0]!;
            if (!('text' in part)) throw new Error('Organization requires a text section.');
            const text = JSON.parse(part.text).source as string;
            calls.push(text);
            const section = await db.organizationSection.findFirstOrThrow({
              where: { run: { userId: input.userId, status: 'RUNNING' }, callPending: true },
            });
            expect(section.attempts).toBeGreaterThan(0);
            if (options.alwaysFail || calls.length === options.failAt) {
              const error = new AiError('LLM_FAILED', 'Fixture provider failure', {
                retryable: true,
              });
              error.costUsd = 0.0007;
              throw error;
            }
            await options.beforeResult?.();
            return {
              output: input.schema.parse({
                reason: 'Only explicit source relationships.',
                nodes: text.includes(quote)
                  ? [
                      { id: 'orion', name: 'Orion', kind: 'PRODUCT', quote },
                      { id: 'vega', name: 'Vega', kind: 'PRODUCT', quote },
                    ]
                  : [],
                relationships: text.includes(quote)
                  ? [{ from: 'orion', to: 'vega', kind: 'PART_OF', quote }]
                  : [],
              }),
              modelRef: 'fixture:standard',
              costUsd: 0.0002,
              usage: { inputTokens: 80, outputTokens: 40 },
            };
          },
        };
      },
    };
    return { deps, calls, snapshots };
  }
  async function ready(id: string) {
    await db.organizationRun.updateMany({
      where: { id, userId: users[0], status: 'RETRY' },
      data: { nextAttemptAt: new Date(0) },
    });
  }
  test('publishes graph effects with one durable section receipt and preserves the source', async () => {
    const f = await queued();
    const ai = dependencies();
    expect(await executeOrganization(users[0]!, f.run.id, ai.deps)).toBe(true);
    const run = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
      include: { sections: true },
    });
    expect(run).toMatchObject({
      status: 'COMPLETED',
      completedSections: 1,
      tokensIn: 80,
      tokensOut: 40,
      model: 'fixture:standard',
      leaseOwner: null,
    });
    expect(Number(run.costUsd)).toBeCloseTo(0.0002, 8);
    expect(run.sections[0]).toMatchObject({
      status: 'COMPLETED',
      attempts: 1,
      callPending: false,
      nodeCount: 2,
      relationshipCount: 1,
    });
    expect(run.sections[0]!.analysis).toMatchObject({
      nodes: [
        { evidence: { authority: 'PREPARED_DOCUMENT' } },
        { evidence: { authority: 'PREPARED_DOCUMENT' } },
      ],
    });
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      3,
    );
    expect(
      await db.transcript.findFirstOrThrow({ where: { id: f.source.id, userId: users[0] } }),
    ).toEqual(f.source);
    expect(await executeOrganization(users[0]!, f.run.id, ai.deps)).toBe(false);
    expect(ai.calls).toHaveLength(1);
  });
  test('retries only unfinished long-source sections while retaining completed usage and model settings', async () => {
    const f = await queued(`${quote}\n${'x'.repeat(49_000)}\n${quote}`);
    const ai = dependencies({ failAt: 2 });
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    const partial = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
    });
    expect(partial).toMatchObject({ status: 'RETRY', completedSections: 1, tokensIn: 80 });
    expect(Number(partial.costUsd)).toBeCloseTo(0.0009, 8);
    await ready(f.run.id);
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    const done = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
      include: { sections: { orderBy: { ordinal: 'asc' } } },
    });
    expect(done).toMatchObject({
      status: 'COMPLETED',
      completedSections: 2,
      tokensIn: 160,
      tokensOut: 80,
    });
    expect(done.sections.map((s) => s.attempts)).toEqual([1, 2]);
    expect(Number(done.costUsd)).toBeCloseTo(0.0011, 8);
    expect(ai.calls).toHaveLength(3);
    expect(ai.snapshots[0]).toBeNull();
    expect(ai.snapshots[1]).toEqual({
      language: 'en',
      reasoning: 'off',
      chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
    });
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      6,
    );
  });
  test('replays a stored paid analysis after graph contention without another provider call', async () => {
    const f = await queued();
    const ai = dependencies();
    const owner = `fixture-${randomUUID()}`;
    expect(await acquireGraphIndexLease(users[0]!, owner)).toBe(true);
    try {
      await executeOrganization(users[0]!, f.run.id, ai.deps);
      expect(
        await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
      ).toMatchObject({ status: 'RETRY', completedSections: 0, lastError: 'GRAPH_BUSY' });
      expect(
        await db.organizationSection.findFirstOrThrow({
          where: { runId: f.run.id, run: { userId: users[0] } },
        }),
      ).toMatchObject({ callPending: false, analysis: { sectionKey: expect.any(String) } });
      expect(
        await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } }),
      ).toBe(0);
    } finally {
      await releaseGraphIndexLease(users[0]!, owner);
    }
    await ready(f.run.id);
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    expect(ai.calls).toHaveLength(1);
    expect(ai.snapshots).toHaveLength(1);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED', completedSections: 1 });
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      3,
    );
  });
  test('never dispatches more than three attempts for a repeatedly failing section', async () => {
    const f = await queued();
    const ai = dependencies({ alwaysFail: true });
    for (let attempt = 0; attempt < 4; attempt++) {
      await ready(f.run.id);
      await executeOrganization(users[0]!, f.run.id, ai.deps);
    }
    expect(ai.calls).toHaveLength(3);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'FAILED', lastError: 'LLM_FAILED' });
    expect(
      await db.organizationSection.findFirstOrThrow({
        where: { runId: f.run.id, run: { userId: users[0] } },
      }),
    ).toMatchObject({ attempts: 3 });
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      0,
    );
  });
  test('does not publish a provider response after organization is disabled', async () => {
    const f = await queued();
    const ai = dependencies({
      beforeResult: () => saveOrganizationPreferences(users[0]!, 'OFF').then(() => undefined),
    });
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    const run = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
    });
    expect(run).toMatchObject({ status: 'CANCELLED', costUsd: null });
    expect(run.warnings).toContain('UNCONFIRMED_USAGE');
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      0,
    );
  });
  test('stops before publication after source correction or replacement of the execution owner', async () => {
    for (const change of ['source', 'owner']) {
      const f = await queued();
      const ai = dependencies({
        beforeResult: async () => {
          if (change === 'source')
            await db.transcript.update({
              where: { id: f.source.id },
              data: {
                correctionRevision: 1,
                correctedMarkdown: 'An updated source.',
                correctedChecksum: 'updated',
              },
            });
          else
            await db.organizationRun.updateMany({
              where: { id: f.run.id, userId: users[0] },
              data: { leaseOwner: 'replacement', attempt: { increment: 1 } },
            });
        },
      });
      await executeOrganization(users[0]!, f.run.id, ai.deps);
      expect(
        await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } }),
      ).toBe(0);
      if (change === 'owner')
        expect(
          await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
        ).toMatchObject({ status: 'RUNNING', leaseOwner: 'replacement', completedSections: 0 });
      await db.organizationRun.updateMany({
        where: { id: f.run.id, userId: users[0] },
        data: { status: 'CANCELLED', leaseOwner: null, leaseExpiresAt: null },
      });
    }
  });
  test('enforces the total deadline before publishing a completed provider response', async () => {
    const f = await queued();
    let offset = 0;
    const ai = dependencies({
      beforeResult: async () => {
        offset = 16 * 60_000;
      },
    });
    await executeOrganization(users[0]!, f.run.id, { ...ai.deps, now: () => Date.now() + offset });
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'FAILED', lastError: 'TIMEOUT' });
    expect(ai.calls).toHaveLength(1);
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      0,
    );
  });
  test('a newly queued source revision cancels an interrupted call without reporting zero cost', async () => {
    const f = await queued();
    let replacementId: string | undefined;
    const ai = dependencies({
      beforeResult: async () => {
        await db.transcript.update({
          where: { id: f.source.id },
          data: {
            correctionRevision: 1,
            correctedMarkdown: 'A newly corrected source.',
            correctedChecksum: 'corrected',
          },
        });
        replacementId = (await enqueueOrganization(users[0]!, f.source.id, 'MANUAL', randomUUID()))!
          .id;
      },
    });
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    const old = await db.organizationRun.findFirstOrThrow({
      where: { id: f.run.id, userId: users[0] },
    });
    expect(old).toMatchObject({ status: 'CANCELLED', lastError: 'SOURCE_CHANGED', costUsd: null });
    expect(old.warnings).toContain('UNCONFIRMED_USAGE');
    expect(replacementId).not.toBe(f.run.id);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: replacementId, userId: users[0] } }),
    ).toMatchObject({ status: 'PENDING', completedSections: 0 });
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      0,
    );
  });
  test('does not grant a fourth execution claim after repeated process interruptions', async () => {
    const f = await queued();
    const ai = dependencies();
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await claimOrganization(users[0]!, f.run.id)).not.toBeNull();
      await db.organizationRun.updateMany({
        where: { id: f.run.id, userId: users[0] },
        data: { leaseExpiresAt: new Date(0) },
      });
    }
    expect(await executeOrganization(users[0]!, f.run.id, ai.deps)).toBe(false);
    expect(ai.calls).toHaveLength(0);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'FAILED', lastError: 'ATTEMPTS_EXHAUSTED', attempt: 3 });
  });
  test('foreign, missing and retired compilation records cannot start provider work', async () => {
    const f = await queued(quote, users[1]);
    const ai = dependencies();
    const legacy = await db.brainCompilation.create({
      data: {
        userId: users[1]!,
        transcriptId: f.source.id,
        contentHash: 'retired',
        status: 'PENDING',
      },
    });
    expect(await executeOrganization(users[0]!, f.run.id, ai.deps)).toBe(false);
    expect(await executeOrganization(users[1]!, legacy.id, ai.deps)).toBe(false);
    expect(await executeOrganization(users[0]!, 'missing', ai.deps)).toBe(false);
    expect(ai.calls).toHaveLength(0);
    expect(
      await db.brainCompilation.findFirstOrThrow({ where: { id: legacy.id, userId: users[1] } }),
    ).toEqual(legacy);
  });
  test('skips captured documents without eligible source spans before preparing or calling a provider', async () => {
    const f = await queued(quote, users[0], true);
    const ai = dependencies();
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    expect(ai.snapshots).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({
      status: 'SKIPPED',
      totalSections: 0,
      completedSections: 0,
      lastError: 'NO_ELIGIBLE_SOURCE',
    });
  });
  test('a section receipt fault rolls back graph effects while retaining the paid analysis for recovery', async () => {
    const f = await queued();
    const ai = dependencies();
    const name = `organization_receipt_fault_${randomUUID().replaceAll('-', '')}`;
    expect(f.run.id).toMatch(/^[a-z0-9]+$/);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."runId" = TG_ARGV[0] AND NEW.status = 'COMPLETED' THEN RAISE EXCEPTION 'injected organization receipt failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE UPDATE ON "OrganizationSection" FOR EACH ROW EXECUTE FUNCTION ${name}('${f.run.id}')`,
      );
      await executeOrganization(users[0]!, f.run.id, ai.deps);
      expect(
        await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
      ).toMatchObject({ status: 'FAILED', completedSections: 0, tokensIn: 80 });
      expect(
        await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } }),
      ).toBe(0);
      expect(await db.brainEdge.count({ where: { userId: users[0] } })).toBe(0);
      expect(
        await db.organizationSection.findFirstOrThrow({
          where: { runId: f.run.id, run: { userId: users[0] } },
        }),
      ).toMatchObject({ callPending: false, analysis: { sectionKey: expect.any(String) } });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "OrganizationSection"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    await db.organizationRun.updateMany({
      where: { id: f.run.id, userId: users[0] },
      data: { status: 'RETRY', nextAttemptAt: new Date(0) },
    });
    await db.organizationSection.updateMany({
      where: { runId: f.run.id, run: { userId: users[0] } },
      data: { status: 'RETRY' },
    });
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    expect(ai.calls).toHaveLength(1);
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      3,
    );
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED', completedSections: 1 });
  });
  test('revalidates stored quotations before materializing cached analysis', async () => {
    const f = await queued();
    const ai = dependencies();
    const owner = `fixture-${randomUUID()}`;
    expect(await acquireGraphIndexLease(users[0]!, owner)).toBe(true);
    try {
      await executeOrganization(users[0]!, f.run.id, ai.deps);
    } finally {
      await releaseGraphIndexLease(users[0]!, owner);
    }
    const receipt = await db.organizationSection.findFirstOrThrow({
      where: { runId: f.run.id, run: { userId: users[0] } },
    });
    const analysis = OrganizationAnalysisSchema.parse(receipt.analysis);
    analysis.nodes[0]!.evidence.excerpt = 'Orion is part of Vega according to fabricated evidence.';
    await db.organizationSection.updateMany({
      where: { runId: f.run.id, run: { userId: users[0] } },
      data: { analysis },
    });
    await ready(f.run.id);
    await executeOrganization(users[0]!, f.run.id, ai.deps);
    expect(ai.calls).toHaveLength(1);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: f.run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'FAILED', lastError: 'INVALID_EVIDENCE', completedSections: 0 });
    expect(await db.brainSource.count({ where: { userId: users[0], sourceId: f.source.id } })).toBe(
      0,
    );
  });
});
