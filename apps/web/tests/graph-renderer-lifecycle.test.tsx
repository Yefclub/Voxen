import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  buildSigmaGraphModel,
  resolveGraphPalette,
  type GraphResp,
} from '../src/client/lib/graph-model';

let graphCanvasMounts = 0;
let graphCanvasUnmounts = 0;
let graphCanvasRenders = 0;
let exposeGraphCanvasRef = true;
const centerGraphMock = mock(() => undefined);
const fitNodesInViewMock = mock(() => undefined);
const zoomInMock = mock(() => undefined);
const zoomOutMock = mock(() => undefined);

const GraphCanvasMock = forwardRef(function GraphCanvasMock(props: Record<string, unknown>, ref) {
  graphCanvasRenders += 1;
  useImperativeHandle(ref, () =>
    exposeGraphCanvasRef
      ? {
          centerGraph: centerGraphMock,
          fitNodesInView: fitNodesInViewMock,
          zoomIn: zoomInMock,
          zoomOut: zoomOutMock,
          getGraph: mock(() => null),
          getControls: mock(() => null),
          exportCanvas: mock(() => ''),
        }
      : null,
  );
  useEffect(() => {
    graphCanvasMounts += 1;
    return () => {
      graphCanvasUnmounts += 1;
    };
  }, []);
  return React.createElement('graph-canvas-mock', { 'data-theme': props.theme });
});

const MotionElementMock = forwardRef(function MotionElementMock(
  { children, ...props }: React.PropsWithChildren<Record<string, unknown>>,
  ref,
) {
  return React.createElement('motion-element-mock', { ...props, ref }, children);
});

const StaticIconMock = (props: Record<string, unknown>) => React.createElement('icon-mock', props);

// Bun mantém mock.module no processo inteiro da suíte. Preserve todos os
// exports reais para não quebrar testes carregados depois deste arquivo — só
// os componentes de elemento viram mock. Sobrescrever `useReducedMotion` aqui
// desligava a animação de TODO teste carregado depois (foi o que quebrou
// `icon-cue-lifecycle` e `icons`); os elementos mockados já ignoram animação.
const actualMotion = await import('motion/react');
mock.module('motion/react', () => ({
  ...actualMotion,
  motion: { div: MotionElementMock, svg: MotionElementMock },
}));

const actualIcons = await import('../src/client/components/ui/icons');
mock.module('@/components/ui/icons', () => ({
  ...actualIcons,
  AlertTriangle: StaticIconMock,
  ArrowLeft: StaticIconMock,
  Box: StaticIconMock,
  BrainCircuit: StaticIconMock,
  ChevronRight: StaticIconMock,
  ExternalLink: StaticIconMock,
  Focus: StaticIconMock,
  Layers3: StaticIconMock,
  Loader2: StaticIconMock,
  Network: StaticIconMock,
  PanelLeft: StaticIconMock,
  RefreshCw: StaticIconMock,
  RotateCw: StaticIconMock,
  Search: StaticIconMock,
  Square: StaticIconMock,
  X: StaticIconMock,
  ZoomIn: StaticIconMock,
  ZoomOut: StaticIconMock,
}));

mock.module('reagraph', () => ({
  GraphCanvas: GraphCanvasMock,
  darkTheme: {
    canvas: { background: '#111111' },
    node: {
      fill: '#ffffff',
      activeFill: '#ffffff',
      opacity: 1,
      selectedOpacity: 1,
      inactiveOpacity: 0.2,
      label: { color: '#ffffff', activeColor: '#ffffff' },
    },
    ring: { fill: '#ffffff', activeFill: '#ffffff' },
    edge: {
      fill: '#ffffff',
      activeFill: '#ffffff',
      opacity: 1,
      selectedOpacity: 1,
      inactiveOpacity: 0.2,
      label: { color: '#ffffff', activeColor: '#ffffff' },
    },
    arrow: { fill: '#ffffff', activeFill: '#ffffff' },
    lasso: { background: 'transparent', border: 'none' },
  },
}));

const { BrainGraph3DCanvas } = await import('../src/client/pages/grafo');

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const listeners = new Map<string, Set<EventListener>>();
const containerMock = {
  addEventListener(type: string, listener: EventListener): void {
    const handlers = listeners.get(type) ?? new Set<EventListener>();
    handlers.add(listener);
    listeners.set(type, handlers);
  },
  removeEventListener(type: string, listener: EventListener): void {
    listeners.get(type)?.delete(listener);
  },
};

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    createElement: () => ({
      width: 1,
      height: 1,
      getContext: (type: string) =>
        type === 'webgl2' ? { getExtension: () => ({ loseContext: mock(() => undefined) }) } : null,
    }),
  },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { setTimeout, clearTimeout },
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

afterAll(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

beforeEach(() => {
  graphCanvasMounts = 0;
  graphCanvasUnmounts = 0;
  graphCanvasRenders = 0;
  exposeGraphCanvasRef = true;
  centerGraphMock.mockClear();
  fitNodesInViewMock.mockClear();
  zoomInMock.mockClear();
  zoomOutMock.mockClear();
  listeners.clear();
});

const DATA = {
  totalNodes: 2,
  totalEdges: 1,
  nodes: [
    {
      id: 'topic-1',
      key: 'topic:1',
      label: 'Tópico principal',
      description: null,
      type: 'topic',
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 3,
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
    {
      id: 'entity-1',
      key: 'entity:1',
      label: 'Entidade',
      description: null,
      type: 'entity',
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 1,
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
  ],
  edges: [
    {
      id: 'edge-1',
      from: 'topic-1',
      to: 'entity-1',
      kind: 'related_to',
      method: 'test',
      confidence: '1',
    },
  ],
} satisfies GraphResp;

function renderGraph(model = buildSigmaGraphModel(DATA), palette = resolveGraphPalette('zinc')) {
  return React.createElement(BrainGraph3DCanvas, {
    model,
    selectedId: null,
    coarsePointer: false,
    palette,
    translate: (key: string) => key,
    onSelect: mock(() => undefined),
    onOpen: mock(() => undefined),
    onFallback: mock(() => undefined),
  });
}

describe('BrainGraph3DCanvas lifecycle', () => {
  test('updates model and theme without remounting GraphCanvas', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderGraph(), { createNodeMock: () => containerMock });
      await Promise.resolve();
    });

    expect(graphCanvasMounts).toBe(1);
    expect(graphCanvasUnmounts).toBe(0);

    const filtered = {
      ...DATA,
      nodes: DATA.nodes.slice(0, 1),
      edges: [],
      totalNodes: 1,
      totalEdges: 0,
    };
    await act(async () => {
      renderer.update(renderGraph(buildSigmaGraphModel(filtered), resolveGraphPalette('light')));
      await Promise.resolve();
    });

    expect(graphCanvasRenders).toBeGreaterThan(1);
    expect(graphCanvasMounts).toBe(1);
    expect(graphCanvasUnmounts).toBe(0);

    await act(async () => renderer.unmount());
    expect(graphCanvasUnmounts).toBe(1);
  });

  test('registers WebGL failure listeners and requests fallback', async () => {
    const onFallback = mock(() => undefined);
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(BrainGraph3DCanvas, {
          ...renderGraph().props,
          onFallback,
        }),
        { createNodeMock: () => containerMock },
      );
      await Promise.resolve();
    });

    expect(listeners.get('webglcontextlost')?.size).toBe(1);
    expect(listeners.get('webglcontextcreationerror')?.size).toBe(1);

    await act(async () => {
      for (const listener of listeners.get('webglcontextcreationerror') ?? [])
        listener({ preventDefault: mock(() => undefined) } as unknown as Event);
    });
    expect(onFallback).toHaveBeenCalledTimes(1);

    await act(async () => renderer.unmount());
  });

  test('keeps initialization budget armed until GraphCanvas publishes its ref', async () => {
    exposeGraphCanvasRef = false;
    const onFallback = mock(() => undefined);
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(BrainGraph3DCanvas, {
          ...renderGraph().props,
          onFallback,
          initializationTimeoutMs: 1,
        }),
        { createNodeMock: () => containerMock },
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Bun.sleep(5);
    });

    expect(graphCanvasMounts).toBe(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  test('cancels initialization budget only after GraphCanvas is ready', async () => {
    const onFallback = mock(() => undefined);
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(BrainGraph3DCanvas, {
          ...renderGraph().props,
          onFallback,
          initializationTimeoutMs: 1,
        }),
        { createNodeMock: () => containerMock },
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Bun.sleep(5);
    });

    expect(graphCanvasMounts).toBe(1);
    expect(onFallback).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  test('exposes modern 3D camera controls and focuses the primary component', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderGraph(), { createNodeMock: () => containerMock });
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'graph.zoomIn' }).props.onClick();
      renderer.root.findByProps({ 'aria-label': 'graph.zoomOut' }).props.onClick();
      renderer.root.findByProps({ 'aria-label': 'graph.focusCore' }).props.onClick();
      renderer.root.findByProps({ 'aria-label': 'graph.fitAll' }).props.onClick();
    });

    expect(zoomInMock).toHaveBeenCalledTimes(1);
    expect(zoomOutMock).toHaveBeenCalledTimes(1);
    expect(fitNodesInViewMock).toHaveBeenCalledWith(['topic-1', 'entity-1'], {
      animated: true,
    });
    expect(fitNodesInViewMock).toHaveBeenCalledWith(undefined, { animated: true });

    await act(async () => renderer.unmount());
  });

  test('never sends removed node ids to camera controls after a topology update', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderGraph(), { createNodeMock: () => containerMock });
      await Promise.resolve();
    });
    const filtered = {
      ...DATA,
      nodes: DATA.nodes.slice(0, 1),
      edges: [],
      totalNodes: 1,
      totalEdges: 0,
    };
    await act(async () => {
      renderer.update(renderGraph(buildSigmaGraphModel(filtered)));
      await Promise.resolve();
    });
    fitNodesInViewMock.mockClear();

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'graph.focusCore' }).props.onClick();
    });

    expect(fitNodesInViewMock).toHaveBeenCalledTimes(1);
    expect(fitNodesInViewMock).toHaveBeenCalledWith(['topic-1'], { animated: true });
    await act(async () => renderer.unmount());
  });
});
