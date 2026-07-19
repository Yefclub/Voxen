import { describe, expect, test } from 'bun:test';
import { BRAIN_PRESERVED_EDGE_METHODS, BRAIN_REFRESHABLE_EDGE_METHODS } from '../src/lib/brain';

describe('brain reprocess methods (spec 105)', () => {
  test('refreshable methods are only cheap heuristics', () => {
    const expected = [
      'entity-heuristic',
      'keyword',
      'semantic-profile',
      'shared-concepts',
      'timeline-adjacent',
    ] as const;
    expect([...BRAIN_REFRESHABLE_EDGE_METHODS].sort()).toEqual([...expected].sort());
  });

  test('llm-grounded and manual are preserved (not refreshable)', () => {
    for (const method of ['llm-grounded', 'manual'] as const) {
      expect(BRAIN_REFRESHABLE_EDGE_METHODS).not.toContain(method);
      expect(BRAIN_PRESERVED_EDGE_METHODS).toContain(method);
    }
  });

  test('no overlap between refreshable and preserved', () => {
    const refreshable = new Set(BRAIN_REFRESHABLE_EDGE_METHODS);
    for (const method of BRAIN_PRESERVED_EDGE_METHODS) {
      expect(refreshable.has(method as (typeof BRAIN_REFRESHABLE_EDGE_METHODS)[number])).toBe(
        false,
      );
    }
  });
});
