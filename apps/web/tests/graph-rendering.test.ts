import { describe, expect, test } from 'bun:test';
import { EDGE_COLORS, NODE_COLORS } from '../src/client/pages/grafo';

const CYTOSCAPE_SAFE_COLOR = /^(#[0-9a-f]{6}|rgba?\([^)]+\))$/i;

describe('graph rendering helpers', () => {
  test('uses canvas-compatible colors for Cytoscape styles', () => {
    const colors = [...Object.values(NODE_COLORS), ...Object.values(EDGE_COLORS)];

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color.toLowerCase()).not.toContain('oklch');
      expect(color).toMatch(CYTOSCAPE_SAFE_COLOR);
    }
  });
});
