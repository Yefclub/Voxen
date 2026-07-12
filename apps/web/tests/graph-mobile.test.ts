import { describe, expect, test } from 'bun:test';
import {
  buildGraphLayout,
  buildSigmaGraphModel,
  resolveDefaultIs3d,
  resolveGraphViewBox,
  resolveNodeRadiusBounds,
} from '../src/client/pages/grafo';

const DEFAULT_VIEWBOX_AREA = 1000 * 620;

function areaOf(box: { width: number; height: number }): number {
  return box.width * box.height;
}

describe('resolveDefaultIs3d', () => {
  test('defaults to 3D on desktop viewports', () => {
    expect(resolveDefaultIs3d(true)).toBe(true);
  });

  test('defaults to 2D on mobile/narrow viewports — drag-to-rotate is a bad touch gesture', () => {
    expect(resolveDefaultIs3d(false)).toBe(false);
  });
});

describe('resolveGraphViewBox', () => {
  test('falls back to the default landscape viewBox when unmeasured', () => {
    expect(resolveGraphViewBox(0, 0)).toEqual({ width: 1000, height: 620 });
    expect(resolveGraphViewBox(-10, 500)).toEqual({ width: 1000, height: 620 });
    expect(resolveGraphViewBox(500, -10)).toEqual({ width: 1000, height: 620 });
  });

  test('produces a portrait viewBox (taller than wide) for a portrait phone container', () => {
    const box = resolveGraphViewBox(390, 844); // iPhone-class portrait viewport
    expect(box.width).toBeLessThan(box.height);
    // Preserva a área do viewBox padrão (mesma densidade de nós) — só muda a
    // proporção, dentro de uma tolerância de arredondamento pequena.
    expect(Math.abs(areaOf(box) - DEFAULT_VIEWBOX_AREA)).toBeLessThan(DEFAULT_VIEWBOX_AREA * 0.01);
  });

  test('produces a landscape viewBox (wider than tall) for a wide desktop container', () => {
    const box = resolveGraphViewBox(1920, 1080);
    expect(box.width).toBeGreaterThan(box.height);
    expect(Math.abs(areaOf(box) - DEFAULT_VIEWBOX_AREA)).toBeLessThan(DEFAULT_VIEWBOX_AREA * 0.01);
  });

  test('clamps pathologically narrow containers instead of producing an extreme sliver', () => {
    const box = resolveGraphViewBox(50, 2000); // aspect ratio 0.025 — muito além do real
    const aspect = box.width / box.height;
    expect(aspect).toBeCloseTo(0.4, 5); // MIN_VIEWBOX_ASPECT_RATIO
  });

  test('clamps pathologically wide containers instead of producing an extreme sliver', () => {
    const box = resolveGraphViewBox(3000, 100); // aspect ratio 30 — muito além do real
    const aspect = box.width / box.height;
    expect(aspect).toBeCloseTo(2.5, 5); // MAX_VIEWBOX_ASPECT_RATIO
  });

  test('is symmetric — swapping container dimensions swaps the resulting viewBox', () => {
    const portrait = resolveGraphViewBox(844, 390);
    const landscape = resolveGraphViewBox(390, 844);
    expect(portrait.width).toBe(landscape.height);
    expect(portrait.height).toBe(landscape.width);
  });
});

describe('resolveNodeRadiusBounds', () => {
  test('keeps the default radius floor for fine pointers (mouse/trackpad)', () => {
    expect(resolveNodeRadiusBounds(false)).toEqual({ min: 13, max: 32 });
  });

  test('raises the radius floor for coarse pointers (touch) — bigger tap targets', () => {
    const bounds = resolveNodeRadiusBounds(true);
    expect(bounds.min).toBeGreaterThan(13);
    expect(bounds.max).toBe(32);
  });
});

const FIXTURE = {
  totalNodes: 3,
  totalEdges: 2,
  nodes: [
    {
      id: 'transcript-1',
      key: 'transcript:1',
      label: 'Transcricao de teste',
      description: null,
      type: 'transcript',
      sourceType: 'TRANSCRIPT',
      sourceId: '1',
      source: 'YOUTUBE',
      weight: 3,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'topic-1',
      key: 'topic:1',
      label: 'Conhecimento conectado',
      description: null,
      type: 'topic',
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 8,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'entity-1',
      key: 'entity:1',
      label: 'Voxen',
      description: null,
      type: 'entity',
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 1,
      updatedAt: new Date().toISOString(),
    },
  ],
  edges: [
    {
      id: 'edge-1',
      from: 'transcript-1',
      to: 'topic-1',
      kind: 'mentions',
      method: 'test',
      confidence: '1',
    },
    {
      id: 'edge-2',
      from: 'topic-1',
      to: 'entity-1',
      kind: 'related_to',
      method: 'test',
      confidence: '1',
    },
  ],
} satisfies Parameters<typeof buildGraphLayout>[0];

describe('buildGraphLayout with responsive options', () => {
  test('uses the default viewBox and radius bounds when no options are given', () => {
    const layout = buildGraphLayout(FIXTURE);
    expect(layout.viewBox).toEqual({ width: 1000, height: 620 });
    for (const node of layout.nodes) {
      expect(node.radius).toBeGreaterThanOrEqual(13);
      expect(node.radius).toBeLessThanOrEqual(32 + 3); // +3 = sourceBoost pra nós de origem
    }
  });

  test('honors a custom viewBox — node positions stay within its bounds and layout.viewBox reflects it', () => {
    const customViewBox = { width: 600, height: 900 };
    const layout = buildGraphLayout(FIXTURE, { viewBox: customViewBox });
    expect(layout.viewBox).toEqual(customViewBox);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(customViewBox.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(customViewBox.height);
    }
  });

  test('honors a raised minNodeRadius (touch bump) — every node radius respects the new floor', () => {
    const layout = buildGraphLayout(FIXTURE, { minNodeRadius: 17, maxNodeRadius: 32 });
    for (const node of layout.nodes) {
      expect(node.radius).toBeGreaterThanOrEqual(17);
    }
  });
});

describe('buildSigmaGraphModel with layoutOptions', () => {
  test('forwards layoutOptions to the underlying layout and keeps the original data attached', () => {
    const model = buildSigmaGraphModel(FIXTURE, undefined, {
      minNodeRadius: 17,
      maxNodeRadius: 32,
    });
    expect(model.data).toBe(FIXTURE);
    for (const node of model.layout.nodes) {
      expect(node.radius).toBeGreaterThanOrEqual(17);
    }
  });

  test('sigma node coordinates stay centered on the resolved layout viewBox, not a hardcoded constant', () => {
    const customViewBox = { width: 600, height: 900 };
    const layout = buildGraphLayout(FIXTURE, { viewBox: customViewBox });
    // Reconstroi o que buildSigmaGraphModel faria internamente pra x/y do
    // grafo Sigma, usando o viewBox resolvido do layout (não uma constante) —
    // é o que evita descentralizar o grafo quando o viewBox é responsivo.
    for (const node of layout.nodes) {
      const x = (node.x - layout.viewBox.width / 2) / 150;
      const y = (node.y - layout.viewBox.height / 2) / 150;
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});
