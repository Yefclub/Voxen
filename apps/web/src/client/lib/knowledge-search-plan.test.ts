import { describe, expect, test } from 'bun:test';
import { parseKnowledgeSearchDisclosure } from './knowledge-search-plan';

describe('knowledge-search transparency', () => {
  test('reads only the bounded structured search plan', () => {
    expect(
      parseKnowledgeSearchDisclosure({
        searchPlan: {
          queries: ['repo oficial', 'github projeto', 'origem'],
          sourceCounts: { transcript: 2, note: 1, external_enrichment: 0 },
          semanticRescueUsed: true,
          hidden: '<unsafe>',
        },
      }),
    ).toEqual({
      queries: ['repo oficial', 'github projeto', 'origem'],
      sourceCounts: { transcript: 2, note: 1, external_enrichment: 0 },
      semanticRescueUsed: true,
    });
  });

  test('rejects malformed tool output', () => {
    expect(parseKnowledgeSearchDisclosure({ searchPlan: { queries: ['ok'] } })).toBeNull();
  });

  test('normalizes, deduplicates, and bounds persisted tool output', () => {
    expect(
      parseKnowledgeSearchDisclosure({
        searchPlan: {
          queries: ['  Repo   oficial  ', 'repo oficial', 'x'.repeat(400), 'quarta consulta'],
          sourceCounts: {},
        },
      }),
    ).toMatchObject({
      queries: ['Repo oficial', 'x'.repeat(300), 'quarta consulta'],
    });
  });
});
