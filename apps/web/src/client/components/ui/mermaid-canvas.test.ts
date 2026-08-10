import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const canvasSource = readFileSync(new URL('./mermaid-canvas.tsx', import.meta.url), 'utf8');
const markdownSource = readFileSync(new URL('./markdown.tsx', import.meta.url), 'utf8');
const i18nSource = readFileSync(
  new URL('../../lib/mermaid-canvas-i18n.ts', import.meta.url),
  'utf8',
);

describe('Mermaid canvas contract', () => {
  test('offers bounded zoom, reset and an expanded workspace', () => {
    expect(canvasSource).toContain('const MIN_SCALE = 0.5');
    expect(canvasSource).toContain('const MAX_SCALE = 3');
    expect(canvasSource).toContain("t('markdown.diagramZoomIn')");
    expect(canvasSource).toContain("t('markdown.diagramZoomOut')");
    expect(canvasSource).toContain("t('markdown.diagramReset')");
    expect(canvasSource).toContain("t('markdown.diagramExpand')");
    expect(canvasSource).toContain('<Dialog open={expanded}');
  });

  test('supports pointer panning and keyboard-accessible canvas navigation', () => {
    expect(canvasSource).toContain('setPointerCapture(event.pointerId)');
    expect(canvasSource).toContain('onPointerMove={handlePointerMove}');
    expect(canvasSource).toContain('onPointerCancel={stopDragging}');
    expect(canvasSource).toContain('tabIndex={0}');
    expect(canvasSource).toContain("['+', '=', '-', '0'].includes(event.key)");
    expect(canvasSource).toContain('event.preventDefault()');
  });

  test('only passes SVG through the existing strict sanitizer boundary', () => {
    expect(markdownSource).toContain('.then(assertSafeMermaidSvg)');
    expect(markdownSource).toContain('sanitizedSvg={svg}');
    expect(canvasSource).toContain('dangerouslySetInnerHTML={{ __html: sanitizedSvg }}');
    expect(canvasSource).not.toContain('dangerouslySetInnerHTML={{ __html: svg }}');
  });

  test('ships accessible controls in Portuguese and English', () => {
    for (const key of [
      'markdown.diagramControls',
      'markdown.diagramZoomIn',
      'markdown.diagramZoomOut',
      'markdown.diagramReset',
      'markdown.diagramExpand',
      'markdown.diagramExpandedTitle',
    ]) {
      expect(i18nSource.split(`'${key}'`).length - 1).toBe(2);
    }
  });
});
