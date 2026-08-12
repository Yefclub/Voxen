import { describe, expect, mock, test } from 'bun:test';
import { searchBrainNodes } from './brain-search';

const aliasNode = {
  id: 'entity-openai',
  key: 'ENTITY:organization:openai',
  type: 'ENTITY' as const,
  label: 'OpenAI',
  description: null,
  status: 'ACTIVE' as const,
  sourceType: null,
  sourceId: null,
  metadata: { entityType: 'ORGANIZATION' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('Brain entity alias search', () => {
  test('returns an owned alias candidate before lexical matches and deduplicates it', async () => {
    const client = {
      $queryRaw: mock(async () => [{ entityNodeId: aliasNode.id }]),
      brainNode: {
        findMany: mock().mockResolvedValueOnce([aliasNode]).mockResolvedValueOnce([aliasNode]),
      },
      transcriptEnrichment: { findMany: mock(async () => []) },
    };

    const results = await searchBrainNodes('user-1', 'Open AI', 8, client as never);

    expect(results).toEqual([aliasNode]);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    expect(client.brainNode.findMany.mock.calls[0]?.[0].where.userId).toBe('user-1');
  });
});
