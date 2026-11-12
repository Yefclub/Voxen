import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { APP_THEMES } from '../src/client/lib/theme';
import { resolveGraphPalette } from '../src/client/lib/graph-model';

const CANVAS_SOURCE = readFileSync(
  new URL('../src/client/components/graph/knowledge-graph-canvas.tsx', import.meta.url),
  'utf8',
);
const FALLBACK_SOURCE = readFileSync(
  new URL('../src/client/components/graph/graph-fallback-svg.tsx', import.meta.url),
  'utf8',
);
const CONTROLS_SOURCE = readFileSync(
  new URL('../src/client/components/graph/graph-canvas-controls.tsx', import.meta.url),
  'utf8',
);
const OVERLAY_CSS = readFileSync(new URL('../src/client/overlay.css', import.meta.url), 'utf8');
const CONTAINERS_CSS = readFileSync(
  new URL('../src/client/graph-containers.css', import.meta.url),
  'utf8',
);
const PAGE_SOURCE = readFileSync(new URL('../src/client/pages/grafo.tsx', import.meta.url), 'utf8');
const PACKAGE_JSON = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
const WEB_PACKAGE_JSON = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

describe('integrated visual verification (spec 219 §acceptance)', () => {
  test('both Voxen appearances resolve readable graph palettes', () => {
    expect(APP_THEMES).toEqual(['light', 'dark']);
    for (const theme of APP_THEMES) {
      const palette = resolveGraphPalette(theme);
      expect(palette.label.toLowerCase()).not.toBe(palette.canvas.toLowerCase());
      expect(palette.activeNode).not.toBe(palette.activeLabel);
      expect(palette.labelStroke.length).toBeGreaterThan(0);
    }
    const canvases = new Set(APP_THEMES.map((theme) => resolveGraphPalette(theme).canvas));
    expect(canvases.size).toBe(2);
  });

  test('camera motion collapses to zero duration under reduced motion', () => {
    expect(CANVAS_SOURCE).toContain('{ duration: reduceMotion ? 0 : 220 }');
    expect(CANVAS_SOURCE).toContain('{ duration: reduceMotion ? 0 : 260 }');
    expect(OVERLAY_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(OVERLAY_CSS).toContain('animation-duration: 1ms');
    expect(OVERLAY_CSS).toContain('transition: none');
  });

  test('viewport breakpoints split map and inspector at readable geometry', () => {
    expect(CONTAINERS_CSS).toContain('localgraph (min-width: 680px)');
    expect(CONTAINERS_CSS).toContain('globalgraph (min-width: 720px)');
    expect(CONTAINERS_CSS).toContain('height: 420px');
    expect(FALLBACK_SOURCE).toContain('useIsCoarsePointer()');
    expect(FALLBACK_SOURCE).toContain('resolveNodeRadiusBounds(coarsePointer)');
  });

  test('WebGL failure keeps an interactive keyboard-operable fallback', () => {
    expect(CANVAS_SOURCE).toContain('if (webglFailed)');
    expect(CANVAS_SOURCE).toContain('<BrainGraphSvg');
    expect(FALLBACK_SOURCE).toContain('role="button"');
    expect(FALLBACK_SOURCE).toContain('tabIndex={0}');
    expect(FALLBACK_SOURCE).toContain("event.key === 'Enter'");
    expect(FALLBACK_SOURCE).toContain("event.key === ' '");
    expect(FALLBACK_SOURCE).toContain("aria-label={translate('graph.title')}");
    expect(PAGE_SOURCE).toContain('onFallbackTo2d={fallbackTo2d}');
  });

  test('viewport controls stay labeled for pointer, keyboard and touch', () => {
    for (const key of ['graph.zoomIn', 'graph.zoomOut', 'graph.fitView', 'graph.focusSelection']) {
      expect(CONTROLS_SOURCE).toContain(`translate('${key}')`);
    }
    expect(CONTROLS_SOURCE).toContain('data-graph-controls');
  });

  test('the graph canvas stays free of AI and 3D dependencies', () => {
    // Spec 220 brings cloud AI providers back to apps/web (lib/ai); the graph
    // workspace itself must still not depend on them or on a 3D engine.
    for (const source of [WEB_PACKAGE_JSON, PACKAGE_JSON]) {
      expect(source).not.toMatch(/"three"/);
    }
    expect(CANVAS_SOURCE).not.toMatch(/openrouter|cuelume|@ai-sdk|from 'ai'|from "ai"/);
  });
});
