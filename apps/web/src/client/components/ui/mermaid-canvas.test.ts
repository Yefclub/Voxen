import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  bindMermaidWheelZoom,
  initialMermaidCanvasState,
  MERMAID_MAX_SCALE,
  MERMAID_MIN_SCALE,
  MERMAID_SCALE_STEP,
  mermaidCanvasReducer,
} from '../../lib/mermaid-canvas-state';
import { enMermaidCanvasMessages, ptBrMermaidCanvasMessages } from '../../lib/mermaid-canvas-i18n';

const canvasSource = readFileSync(new URL('./mermaid-canvas.tsx', import.meta.url), 'utf8');
const markdownSource = readFileSync(new URL('./markdown.tsx', import.meta.url), 'utf8');

class FakeWheelTarget {
  listener: ((event: WheelEvent) => void) | null = null;
  options: AddEventListenerOptions | boolean | undefined;

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listener = listener as (event: WheelEvent) => void;
    this.options = options;
  }

  removeEventListener(): void {
    this.listener = null;
  }

  emit(event: Partial<WheelEvent>): void {
    this.listener?.(event as WheelEvent);
  }
}

describe('Mermaid canvas contract', () => {
  test('bounds zoom and resets scale plus displacement', () => {
    let state = initialMermaidCanvasState;
    for (let index = 0; index < 20; index += 1) {
      state = mermaidCanvasReducer(state, { type: 'zoom', delta: MERMAID_SCALE_STEP });
    }
    expect(state.viewport.scale).toBe(MERMAID_MAX_SCALE);
    for (let index = 0; index < 20; index += 1) {
      state = mermaidCanvasReducer(state, { type: 'zoom', delta: -MERMAID_SCALE_STEP });
    }
    expect(state.viewport.scale).toBe(MERMAID_MIN_SCALE);
    state = mermaidCanvasReducer(state, { type: 'pan', x: 70, y: -25 });
    expect(state.viewport).toMatchObject({ x: 70, y: -25 });
    expect(mermaidCanvasReducer(state, { type: 'reset-viewport' }).viewport).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  test('native modified-wheel handler cancels browser zoom and cleans up', () => {
    const target = new FakeWheelTarget();
    const deltas: number[] = [];
    const cleanup = bindMermaidWheelZoom(target as unknown as HTMLElement, (delta) =>
      deltas.push(delta),
    );
    let prevented = 0;
    target.emit({
      ctrlKey: true,
      metaKey: false,
      deltaY: -1,
      preventDefault: () => {
        prevented += 1;
      },
    });
    expect(target.options).toEqual({ passive: false });
    expect(prevented).toBe(1);
    expect(deltas).toEqual([MERMAID_SCALE_STEP]);

    target.emit({
      ctrlKey: false,
      metaKey: false,
      deltaY: 1,
      preventDefault: () => {
        prevented += 1;
      },
    });
    expect(prevented).toBe(1);
    expect(deltas).toHaveLength(1);
    cleanup();
    expect(target.listener).toBeNull();
  });

  test('capture loss, dialog close and content changes cannot leave dragging stuck', () => {
    const dragging = mermaidCanvasReducer(initialMermaidCanvasState, {
      type: 'set-dragging',
      dragging: true,
    });
    expect(dragging.dragging).toBeTrue();
    expect(
      mermaidCanvasReducer(dragging, { type: 'set-dragging', dragging: false }).dragging,
    ).toBeFalse();
    expect(
      mermaidCanvasReducer(
        { ...dragging, expanded: true },
        { type: 'set-expanded', expanded: false },
      ).dragging,
    ).toBeFalse();
    expect(mermaidCanvasReducer(dragging, { type: 'content-changed' })).toMatchObject({
      dragging: false,
      viewport: { scale: 1, x: 0, y: 0 },
    });
  });

  test('wires pointer loss, keyboard focus and a native wheel listener', () => {
    expect(canvasSource).toContain('onLostPointerCapture={stopDragging}');
    expect(canvasSource).toContain('return bindMermaidWheelZoom(canvas');
    expect(canvasSource).not.toContain('onWheel=');
    expect(canvasSource).toContain('tabIndex={0}');
    expect(canvasSource).toContain("['+', '=', '-', '0'].includes(event.key)");
    expect(canvasSource).toContain("type: 'set-expanded', expanded");
  });

  test('only passes SVG through the existing strict sanitizer boundary', () => {
    expect(markdownSource).toContain('.then(assertSafeMermaidSvg)');
    expect(markdownSource).toContain('sanitizedSvg={svg}');
    expect(canvasSource).toContain('dangerouslySetInnerHTML={{ __html: sanitizedSvg }}');
    expect(canvasSource).not.toContain('dangerouslySetInnerHTML={{ __html: svg }}');
  });

  test('ships accessible controls in Portuguese and English', () => {
    expect(Object.keys(enMermaidCanvasMessages)).toEqual(Object.keys(ptBrMermaidCanvasMessages));
    expect(Object.values(enMermaidCanvasMessages).every(Boolean)).toBeTrue();
    expect(Object.values(ptBrMermaidCanvasMessages).every(Boolean)).toBeTrue();
  });
});
