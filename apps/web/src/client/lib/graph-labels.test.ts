import { describe, expect, test } from 'bun:test';
import {
  fitGraphLabel,
  createSigmaNodeHoverRenderer,
  createSigmaNodeLabelRenderer,
} from './graph-renderer';
import { resolveGraphPalette } from './graph-model';

describe('graph label bounds', () => {
  const measure = (text: string): number => Array.from(text).length * 8;
  test('preserves readable names and normalizes whitespace', () => {
    expect(fitGraphLabel('  Source\n  passage ', 200, measure)).toBe('Source passage');
  });
  test('fits long Unicode names by pixels without splitting surrogate pairs', () => {
    const label = fitGraphLabel('📚'.repeat(80), 80, measure);
    expect(measure(label)).toBeLessThanOrEqual(80);
    expect(label).toBe('📚'.repeat(9) + '…');
    expect(fitGraphLabel('Long name', 0, measure)).toBe('');
  });
  test('keeps hover boxes inside a narrow viewport at every edge', () => {
    for (const [x, y] of [
      [0, 0],
      [319, 0],
      [319, 199],
      [0, 199],
    ] as const) {
      let box: number[] = [];
      let text = '';
      const context = {
        canvas: { clientWidth: 320, clientHeight: 200 },
        save() {},
        restore() {},
        beginPath() {},
        fill() {},
        stroke() {},
        measureText: (value: string) => ({ width: measure(value) }),
        roundRect(...values: number[]) {
          box = values;
        },
        fillText(value: string) {
          text = value;
        },
      } as unknown as CanvasRenderingContext2D;
      const draw = createSigmaNodeHoverRenderer(resolveGraphPalette('light'));
      draw(context, { x, y, size: 8, label: 'A very long document title '.repeat(10), color: '' }, {
        labelWeight: '500',
        labelSize: 13,
        labelFont: 'Inter',
      } as Parameters<typeof draw>[2]);
      expect(box[0]).toBeGreaterThanOrEqual(8);
      expect(box[1]).toBeGreaterThanOrEqual(8);
      expect(box[0]! + box[2]!).toBeLessThanOrEqual(312);
      expect(box[1]! + box[3]!).toBeLessThanOrEqual(192);
      expect(text.endsWith('…')).toBe(true);
    }
  });
});

describe('graph label collisions', () => {
  function fixture() {
    const painted: { text: string; x: number; y: number }[] = [];
    const context = {
      canvas: { clientWidth: 320, clientHeight: 200 },
      save() {},
      restore() {},
      strokeText() {},
      measureText: (value: string) => ({
        width: value.length * 8,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
      }),
      fillText(text: string, x: number, y: number) {
        painted.push({ text, x, y });
      },
    } as unknown as CanvasRenderingContext2D;
    const draw = createSigmaNodeLabelRenderer(resolveGraphPalette('linear'));
    const settings = { labelWeight: '500', labelSize: 13, labelFont: 'Inter' } as Parameters<
      typeof draw
    >[2];
    return { painted, context, draw, settings };
  }
  test('prioritizes a selected/source label and defers colliding names', () => {
    const { draw, context, settings, painted } = fixture();
    const node = { x: 100, y: 100, size: 8, color: '', label: 'Secondary label', zIndex: 1 };
    draw(context, node, settings);
    draw(context, { ...node, label: 'Source document', zIndex: 4 }, settings);
    expect(painted).toHaveLength(0);
    draw.flush([node]);
    expect(painted[0]?.text).toBe('Source document');
    for (let i = 0; i < painted.length; i++)
      for (let j = i + 1; j < painted.length; j++) {
        const a = painted[i]!,
          b = painted[j]!;
        expect(
          a.x < b.x + b.text.length * 8 &&
            a.x + a.text.length * 8 > b.x &&
            a.y - 10 < b.y + 3 &&
            a.y + 3 > b.y - 10,
        ).toBe(false);
      }
  });
  test('releases occupied regions between camera frames', () => {
    const { draw, context, settings, painted } = fixture();
    const node = { x: 100, y: 100, size: 8, color: '', label: 'Source document' };
    for (let i = 0; i < 3; i++) {
      draw.reset();
      draw(context, node, settings);
      draw.flush([node]);
    }
    expect(painted).toHaveLength(3);
    expect(painted[0]).toEqual(painted[2]);
  });
  test('keeps labels away from other node markers and reserved controls', () => {
    const { draw, context, settings, painted } = fixture();
    const node = { x: 30, y: 100, size: 8, color: '', label: 'Source document' };
    draw(context, node, settings);
    draw.flush([node, { x: 75, y: 100, size: 10 }], [{ left: 0, top: 0, right: 320, bottom: 85 }]);
    expect(painted).toHaveLength(1);
    expect(painted[0]!.y).toBeGreaterThan(120);
  });
});

describe('graph label wiring (spec 219 §6)', () => {
  test('full-graph page routes Sigma label passes through the measured renderer', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../pages/grafo.tsx', import.meta.url), 'utf8');
    // Settings hand the buffered renderer to Sigma; the frame loop resets
    // before render and flushes obstacles + reserved controls after render —
    // otherwise draw() would only accumulate and never paint.
    expect(source).toContain('defaultDrawNodeLabel: labelRenderer');
    expect(source).toContain("renderer.on('beforeRender'");
    expect(source).toContain("renderer.on('afterRender'");
    expect(source).toContain('labelRendererRef.current.reset()');
    expect(source).toContain('labelRendererRef.current.flush(');
    expect(source).toContain('data-graph-controls');
  });
});
