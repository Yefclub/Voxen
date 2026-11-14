import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { AiError } from '../src/lib/ai/errors';
import { saveResearchPreferences } from '../src/lib/research/preferences';
import { enqueueResearch } from '../src/lib/research/queue';
import { executeResearch, type ResearchRunnerDependencies } from '../src/lib/research/runner';
import { ResearchPlanSchema } from '../src/lib/research/generate';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const quote = 'The original specification requires forty-two reviewers before publication.';
const users: string[] = [];
suite('durable grounded research execution', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `research-runner-${randomUUID()}@example.test`,
              name: 'Research execution',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
    for (const id of users) await saveResearchPreferences(id, 'MANUAL');
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function queued(userId = users[0]!) {
    await saveResearchPreferences(userId, 'MANUAL');
    const source = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/original',
        title: 'Original source',
        plainText: 'The original saved source remains unchanged.',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'fixture.md',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'original-sum',
      },
    });
    const row = (await enqueueResearch(userId, source.id, 'MANUAL', randomUUID()))!;
    return { source, row };
  }
  function dependencies(
    options: {
      noResearch?: boolean;
      failClaims?: boolean;
      onFetch?: () => Promise<void>;
      onClaims?: () => Promise<void>;
      hold?: Promise<void>;
      entered?: () => void;
    } = {},
  ) {
    const calls = { prepare: 0, model: 0, search: 0, fetch: 0 };
    const deps: ResearchRunnerDependencies = {
      prepare: async () => {
        calls.prepare++;
        return {
          execution: {
            language: 'en',
            reasoning: 'off',
            chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
          },
          dependencies: {
            generate: async (input) => {
              calls.model++;
              if (Object.is(input.schema, ResearchPlanSchema))
                return {
                  output: input.schema.parse({
                    rationale: 'Check the original specification.',
                    questions: options.noResearch
                      ? []
                      : [{ query: 'original specification official reviewers', priority: 3 }],
                  }),
                  modelRef: 'fixture:model',
                  costUsd: 0.0003,
                  usage: { inputTokens: 100, outputTokens: 50 },
                };
              if (options.failClaims) {
                const error = new AiError('LLM_FAILED', 'Fixture transient error', {
                  retryable: true,
                });
                error.costUsd = 0.0007;
                throw error;
              }
              await options.onClaims?.();
              return {
                output: input.schema.parse({
                  rationale: 'Verified in the original document.',
                  claims: [{ text: 'The specification requires forty-two reviewers.', quote }],
                }),
                modelRef: 'fixture:model',
                costUsd: 0.0003,
                usage: { inputTokens: 100, outputTokens: 50 },
              };
            },
            search: async () => {
              calls.search++;
              return {
                retrievedAt: '2026-11-13T20:00:00.000Z',
                sources: [
                  {
                    url: 'https://example.com/spec',
                    title: 'Original specification',
                    excerpt: 'Search text is not evidence.',
                  },
                ],
              };
            },
            fetchPage: async (url) => {
              calls.fetch++;
              options.entered?.();
              await options.hold;
              await options.onFetch?.();
              return {
                url,
                title: 'Original specification',
                text: quote,
                retrievedAt: '2026-11-13T20:00:00.000Z',
                truncated: false,
              };
            },
          },
        };
      },
    };
    return { deps, calls };
  }
  test('publishes an owned suggestion with citations and usage while preserving the source', async () => {
    const { source, row } = await queued();
    const f = dependencies();
    expect(await executeResearch(users[1]!, row.id, f.deps)).toBe(false);
    expect(f.calls.prepare).toBe(0);
    expect(await executeResearch(users[0]!, row.id, f.deps)).toBe(true);
    const result = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: row.id } });
    expect(result).toMatchObject({
      status: 'READY',
      reviewState: 'SUGGESTED',
      attempt: 1,
      leaseOwner: null,
      tokensIn: 200,
      tokensOut: 100,
      searchCallCount: 1,
      searchResultCount: 1,
      sourceVersion: 1,
      sourceChecksum: 'original-sum',
    });
    expect(result.content).toContain('forty-two reviewers');
    expect(result.citations).toEqual([
      {
        url: 'https://example.com/spec',
        title: 'Original specification',
        excerpt: quote,
        retrievedAt: '2026-11-13T20:00:00.000Z',
      },
    ]);
    expect(Number(result.costUsd)).toBeCloseTo(0.0006, 6);
    expect(result.generationSettings).toMatchObject({
      execution: {
        language: 'en',
        reasoning: 'off',
        chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      },
    });
    expect((await db.transcript.findUniqueOrThrow({ where: { id: source.id } })).plainText).toBe(
      source.plainText,
    );
  });
  test('records an explicit no-research result without network calls', async () => {
    const { row } = await queued();
    const f = dependencies({ noResearch: true });
    await executeResearch(users[0]!, row.id, f.deps);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'NO_RESEARCH_NEEDED',
      content: '',
      noResearchReason: 'Check the original specification.',
    });
    expect(f.calls).toEqual({ prepare: 1, model: 1, search: 0, fetch: 0 });
  });
  test('retains billed failed attempts and completed calls across a bounded retry', async () => {
    const { row } = await queued();
    const f = dependencies({ failClaims: true });
    await executeResearch(users[0]!, row.id, f.deps);
    const failed = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed).toMatchObject({
      status: 'RETRY',
      lastError: 'LLM_FAILED',
      content: '',
      attempt: 1,
      leaseOwner: null,
    });
    expect(Number(failed.costUsd)).toBeCloseTo(0.001, 6);
    await db.transcriptEnrichment.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await executeResearch(users[0]!, row.id, dependencies().deps);
    const recovered = await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: row.id } });
    expect(recovered).toMatchObject({ status: 'READY', attempt: 2, searchCallCount: 2 });
    expect(Number(recovered.costUsd)).toBeCloseTo(0.0016, 6);
    expect(recovered.startedAt).toEqual(failed.startedAt);
  });
  test('stops after consent is disabled during a page request', async () => {
    const { row } = await queued();
    const f = dependencies({
      onFetch: async () => {
        await saveResearchPreferences(users[0]!, 'OFF');
      },
    });
    await executeResearch(users[0]!, row.id, f.deps);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'CANCELLED',
      content: '',
      lastError: 'POLICY_CHANGED',
    });
    expect(f.calls.model).toBe(1);
  });
  test('rejects stale output after a corrected source commits', async () => {
    const { source, row } = await queued();
    const f = dependencies({
      onClaims: async () => {
        await db.transcript.update({
          where: { id: source.id },
          data: {
            correctionRevision: 1,
            correctedChecksum: 'new-correction',
            correctedPlainText: 'The user correction takes priority.',
          },
        });
      },
    });
    await executeResearch(users[0]!, row.id, f.deps);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'CANCELLED',
      content: '',
      staleReason: 'source-version-changed',
    });
    expect(
      (await db.transcript.findUniqueOrThrow({ where: { id: source.id } })).correctedPlainText,
    ).toBe('The user correction takes priority.');
  });
  test('does not overwrite a replacement lease owner after a late provider result', async () => {
    const { row } = await queued();
    const f = dependencies({
      onClaims: async () => {
        await db.transcriptEnrichment.update({
          where: { id: row.id },
          data: { leaseOwner: 'replacement', leaseExpiresAt: new Date(Date.now() + 90_000) },
        });
      },
    });
    await executeResearch(users[0]!, row.id, f.deps);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'RUNNING',
      leaseOwner: 'replacement',
      content: '',
      lastError: null,
    });
  });
  test('enforces the total execution deadline before another provider call', async () => {
    const { row } = await queued();
    const f = dependencies();
    await db.transcriptEnrichment.update({
      where: { id: row.id },
      data: { status: 'RETRY', attempt: 1, startedAt: new Date(Date.now() - 11 * 60_000) },
    });
    await executeResearch(users[0]!, row.id, f.deps);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'FAILED',
      lastError: 'TIMEOUT',
      content: '',
    });
    expect(f.calls.model).toBe(0);
    expect(f.calls.search).toBe(0);
  });
});
