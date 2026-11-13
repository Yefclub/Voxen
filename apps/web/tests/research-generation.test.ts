import { describe, expect, test } from 'bun:test';
import { AiError } from '../src/lib/ai/errors';
import type { GenerateStructuredInput } from '../src/lib/ai/client';
import {
  generateResearch,
  ResearchPlanSchema,
  type ResearchDependencies,
  type ResearchUsage,
} from '../src/lib/research/generate';
import { ResearchError, type ResearchSource } from '../src/lib/research/queue';

const quote = 'The Orion release process requires exactly forty-two reviewers before acceptance.';
const source: ResearchSource = {
  id: 'source',
  userId: 'owner',
  title: 'Orion release process',
  plainText: 'Original Orion process.',
  correctedPlainText: null,
  sourceVersion: 1,
  sourceChecksum: 'sum',
  correctionRevision: 0,
  correctedChecksum: null,
  correctionState: 'ACTIVE',
};
function fixture(
  options: {
    noResearch?: boolean;
    invalidQuote?: boolean;
    unsafeQuery?: boolean;
    unsafeUrl?: boolean;
  } = {},
) {
  const calls = { model: 0, search: [] as string[], fetch: [] as string[] };
  const usage: ResearchUsage = {
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    searchCalls: 0,
    searchResults: 0,
    fetchCalls: 0,
    models: new Set(),
    warnings: new Set(),
  };
  const dependencies: ResearchDependencies = {
    generate: async <T>(input: GenerateStructuredInput<T>) => {
      calls.model++;
      const answer = Object.is(input.schema, ResearchPlanSchema)
        ? {
            rationale: 'Check the original release process documentation.',
            questions: options.noResearch
              ? []
              : [
                  {
                    query: options.unsafeQuery
                      ? 'Bearer secretExampleCredential1234'
                      : 'Orion release process official documentation',
                    priority: 3,
                  },
                ],
          }
        : {
            rationale: 'The original documentation confirms the requirement.',
            claims: [
              {
                text: 'The documented release process requires forty-two reviewers.',
                quote: options.invalidQuote
                  ? 'A fabricated quotation that never appeared in the fetched source document.'
                  : quote,
              },
            ],
          };
      return {
        output: input.schema.parse(answer),
        modelRef: 'fixture:model',
        usage: { inputTokens: 100, outputTokens: 50 },
        costUsd: 0.0003,
      };
    },
    search: async (_userId, query) => {
      calls.search.push(query);
      return {
        retrievedAt: new Date().toISOString(),
        sources: [
          {
            url: options.unsafeUrl
              ? 'http://127.0.0.1/private'
              : 'https://example.com/orion/(release)',
            title: 'Original release documentation',
            excerpt: 'A search snippet is not evidence.',
          },
        ],
      };
    },
    fetchPage: async (url) => {
      calls.fetch.push(url);
      return {
        url,
        title: 'Release documentation',
        text: `Introduction.\n${quote.replace('process requires', 'process\nrequires')}\nClosing details.`,
        retrievedAt: '2026-11-13T20:00:00.000Z',
        truncated: false,
      };
    },
  };
  const run = (checkpoint: () => Promise<void> = async () => undefined) =>
    generateResearch({
      userId: source.userId,
      source,
      language: 'en',
      signal: new AbortController().signal,
      usage,
      checkpoint,
      dependencies,
    });
  return { calls, usage, dependencies, run };
}
describe('bounded grounded external research', () => {
  test('records no-research without discovery or page reads', async () => {
    const f = fixture({ noResearch: true });
    expect(await f.run()).toMatchObject({
      status: 'NO_RESEARCH_NEEDED',
      citations: [],
      content: '',
      queries: [],
    });
    expect(f.calls.search).toEqual([]);
    expect(f.calls.fetch).toEqual([]);
    expect(f.usage.costUsd).toBeCloseTo(0.0003, 6);
  });
  test('publishes only fetched evidence with original URLs, verified excerpts and retrieval dates', async () => {
    const f = fixture();
    const result = await f.run();
    expect(result.status).toBe('READY');
    expect(result.citations).toEqual([
      {
        url: 'https://example.com/orion/(release)',
        title: 'Release documentation',
        excerpt: quote,
        retrievedAt: '2026-11-13T20:00:00.000Z',
      },
    ]);
    expect(result.content).toContain('https://example.com/orion/%28release%29');
    expect(result.content).not.toContain('A search snippet');
    expect(f.calls.search).toHaveLength(1);
    expect(f.calls.fetch).toHaveLength(1);
    expect(f.usage).toMatchObject({ tokensIn: 200, tokensOut: 100, searchCalls: 1, fetchCalls: 1 });
  });
  test('rejects invented quotes rather than attaching an unsupported citation', async () => {
    const f = fixture({ invalidQuote: true });
    await expect(f.run()).rejects.toThrow('UNGROUNDED_RESULT');
  });
  test('blocks credential-shaped queries and unsafe discovery URLs before page retrieval', async () => {
    const query = fixture({ unsafeQuery: true });
    await expect(query.run()).rejects.toThrow('UNSAFE_QUERY');
    expect(query.calls.search).toEqual([]);
    const url = fixture({ unsafeUrl: true });
    await expect(url.run()).rejects.toThrow('NO_SEARCH_RESULTS');
    expect(url.calls.fetch).toEqual([]);
  });
  test('stops after a stale search result without fetching or interpreting a page', async () => {
    const f = fixture();
    let current = true;
    const search = f.dependencies.search;
    f.dependencies.search = async (...args) => {
      const result = await search(...args);
      current = false;
      return result;
    };
    await expect(
      f.run(async () => {
        if (!current) throw new ResearchError('LEASE_LOST');
      }),
    ).rejects.toThrow('LEASE_LOST');
    expect(f.calls.fetch).toEqual([]);
    expect(f.calls.model).toBe(1);
  });
  test('does not restart paid work after the durable discovery or fetch budget is exhausted', async () => {
    for (const exhausted of ['searchCalls', 'fetchCalls'] as const) {
      const f = fixture();
      f.usage[exhausted] = exhausted === 'searchCalls' ? 3 : 4;
      await expect(f.run()).rejects.toThrow('CALL_LIMIT');
      expect(f.calls).toEqual({ model: 0, search: [], fetch: [] });
    }
  });

  test('includes billed failed model attempts in the accumulated cost', async () => {
    const f = fixture();
    const generate = f.dependencies.generate;
    f.dependencies.generate = async (input) => {
      if (!Object.is(input.schema, ResearchPlanSchema)) {
        const error = new AiError('LLM_FAILED', 'Transient fixture failure', { retryable: true });
        error.costUsd = 0.0007;
        throw error;
      }
      return generate(input);
    };
    await expect(f.run()).rejects.toThrow('Transient fixture failure');
    expect(f.usage.costUsd).toBeCloseTo(0.001, 6);
  });
});
