import { describe, expect, test } from 'bun:test';
import {
  cosineSimilarity,
  fuseHybridScores,
  readEmbeddingFromMetadata,
} from '../src/lib/hybrid-search';

describe('hybrid-search', () => {
  test('cosineSimilarity is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  test('fuseHybridScores orders by blended score', () => {
    const fused = fuseHybridScores(
      [
        { id: 'a', lexicalScore: 1, vectorScore: 0.1 },
        { id: 'b', lexicalScore: 0.5, vectorScore: 0.9 },
      ],
      { alpha: 0.5 },
    );
    expect(fused[0]?.id).toBe('b');
  });

  test('readEmbeddingFromMetadata', () => {
    expect(readEmbeddingFromMetadata(null)).toBeNull();
    expect(
      readEmbeddingFromMetadata({
        embedding: { model: 'x', dims: 3, vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
      }),
    ).toHaveLength(8);
  });
});
