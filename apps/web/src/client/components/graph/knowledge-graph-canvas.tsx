import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type SigmaRenderer from 'sigma';
import {
  type GraphNode,
  type GraphPalette,
  type SigmaEdgeAttributes,
  type SigmaGraphModel,
  type SigmaNodeAttributes,
} from '../../lib/graph-model';
import {
  attachMeasuredLabelLayer,
  createSigmaNodeLabelRenderer,
  sigmaRendererSettings,
} from '../../lib/graph-renderer';
import type { TranslateFn } from '../../lib/i18n';
import { GraphViewportControls } from './graph-canvas-controls';
import { BrainGraphSvg } from './graph-fallback-svg';
type SigmaRendererConstructor = typeof SigmaRenderer;
let sigmaModulePromise: Promise<SigmaRendererConstructor> | null = null;
function loadSigma(): Promise<SigmaRendererConstructor> {
  sigmaModulePromise ??= import('sigma').then((module) => module.default);
  return sigmaModulePromise;
}
export function KnowledgeGraphCanvas({
  model,
  selectedId,
  palette,
  translate,
  onSelect,
  onOpen,
}: {
  model: SigmaGraphModel | null;
  selectedId: string | null;
  palette: GraphPalette;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SigmaRenderer<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const modelRef = useRef(model);
  const paletteRef = useRef(palette);
  const labelRenderer = useMemo(() => createSigmaNodeLabelRenderer(palette), [palette]);
  const labelRendererRef = useRef(labelRenderer);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [rendererVersion, setRendererVersion] = useState(0);
  const [SigmaConstructor, setSigmaConstructor] = useState<SigmaRendererConstructor | null>(null);
  const [zoom, setZoom] = useState(100);
  const fittedTopology = useRef<string | null>(null);
  const hasModel = Boolean(model);
  modelRef.current = model;
  paletteRef.current = palette;
  labelRendererRef.current = labelRenderer;

  useEffect(() => {
    let cancelled = false;
    void loadSigma()
      .then((Sigma) => {
        if (!cancelled) setSigmaConstructor(() => Sigma);
      })
      .catch(() => {
        if (!cancelled) setWebglFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const initialModel = modelRef.current;
    const initialPalette = paletteRef.current;
    if (webglFailed || !SigmaConstructor || !initialModel || !containerRef.current) return;
    const container = containerRef.current;
    let renderer: SigmaRenderer<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      setWebglFailed(true);
    };
    container.addEventListener('webglcontextlost', handleContextLost, true);
    try {
      renderer = new SigmaConstructor(
        initialModel.graph,
        containerRef.current,
        sigmaRendererSettings(initialModel, initialPalette, labelRendererRef.current),
      );
      rendererRef.current = renderer;
      attachMeasuredLabelLayer(renderer, container, () => labelRendererRef.current);
      fittedTopology.current = null;
      const camera = renderer.getCamera();
      camera.on('updated', () => setZoom(Math.round(100 / camera.getState().ratio)));
      renderer.on('clickNode', ({ node }) => onSelect(node));
      renderer.on('doubleClickNode', ({ node, event }) => {
        event.preventSigmaDefault();
        const currentModel = modelRef.current;
        if (currentModel?.graph.hasNode(node))
          onOpen(currentModel.graph.getNodeAttributes(node).original);
      });
      renderer.on('clickStage', () => onSelect(null));
      renderer.on('enterNode', ({ node }) => setHoveredId(node));
      renderer.on('leaveNode', () => setHoveredId(null));
      if ('ResizeObserver' in window) {
        // Resizing canvases alone clears their pixels. Schedule processing and
        // painting together so sidebar/container changes cannot leave a blank map.
        resizeObserver = new ResizeObserver(() => renderer?.refresh({ schedule: true }));
        resizeObserver.observe(containerRef.current);
      }
      renderer.refresh();
      setRendererVersion((version) => version + 1);
    } catch {
      setWebglFailed(true);
    }
    return () => {
      resizeObserver?.disconnect();
      container.removeEventListener('webglcontextlost', handleContextLost, true);
      renderer?.kill();
      rendererRef.current = null;
    };
  }, [SigmaConstructor, hasModel, onOpen, onSelect, webglFailed]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !model) return;
    const previous = renderer.getGraph();
    if (fittedTopology.current === model.topologyKey && previous !== model.graph) {
      model.graph.forEachNode((id) => {
        if (previous.hasNode(id))
          model.graph.mergeNodeAttributes(id, {
            x: previous.getNodeAttribute(id, 'x'),
            y: previous.getNodeAttribute(id, 'y'),
          });
      });
    }
    setHoveredId((current) => (current && model.graph.hasNode(current) ? current : null));
    renderer.setGraph(model.graph);
    renderer.setSettings(sigmaRendererSettings(model, palette, labelRenderer));
    renderer.refresh();
  }, [model, palette, rendererVersion, labelRenderer]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !model || fittedTopology.current === model.topologyKey) return;
    fittedTopology.current = model.topologyKey;
    // Sigma's camera uses framed graph coordinates, whose center is (0.5, 0.5).
    // Show every component initially; refreshes with unchanged topology keep the view.
    renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  }, [model, rendererVersion]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !model) return;
    const candidate = hoveredId ?? selectedId;
    const activeId = candidate && model.graph.hasNode(candidate) ? candidate : null;
    const activeNeighbors = activeId
      ? (model.neighborhoods.get(activeId) ?? new Set([activeId]))
      : null;
    renderer.setSetting('nodeReducer', (node, nodeData) => {
      if (!activeId || !activeNeighbors) return nodeData;
      const isActive = node === activeId;
      const isNeighbor = activeNeighbors.has(node);
      if (!isActive && !isNeighbor)
        return {
          ...nodeData,
          color: palette.dimNode,
          label: '',
          size: Math.max(2.5, nodeData.size * 0.7),
          zIndex: 0,
        };
      return {
        ...nodeData,
        color: isActive ? palette.activeNode : nodeData.color,
        size: nodeData.size * (isActive ? 1.45 : 1.12),
        zIndex: isActive ? 4 : 3,
        forceLabel: isActive,
      };
    });
    renderer.setSetting('edgeReducer', (_edge, edgeData) => {
      if (!activeId)
        return model.graph.order > 140 || model.graph.size > 360
          ? { ...edgeData, color: palette.dimEdge }
          : edgeData;
      const connected = edgeData.from === activeId || edgeData.to === activeId;
      return {
        ...edgeData,
        color: connected ? edgeData.color : palette.dimEdge,
        hidden: !connected,
        size: connected ? edgeData.size * 1.4 : edgeData.size,
      };
    });
    renderer.refresh();
  }, [hoveredId, model, palette, rendererVersion, selectedId]);

  const moveCamera = useCallback(
    (ratioFactor: number) => {
      const camera = rendererRef.current?.getCamera();
      if (!camera) return;
      void camera.animate(
        { ratio: camera.getState().ratio * ratioFactor },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [reduceMotion],
  );
  const resetCamera = useCallback(() => {
    void rendererRef.current
      ?.getCamera()
      .animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: reduceMotion ? 0 : 260 });
  }, [reduceMotion]);
  const focusSelection = useCallback(() => {
    const renderer = rendererRef.current;
    const node = selectedId ? renderer?.getNodeDisplayData(selectedId) : null;
    if (node)
      void renderer
        ?.getCamera()
        .animate({ x: node.x, y: node.y }, { duration: reduceMotion ? 0 : 260 });
  }, [reduceMotion, selectedId]);

  if (!model) return <div className="absolute inset-0" />;
  if (webglFailed) {
    return (
      <BrainGraphSvg
        model={model}
        selectedId={selectedId}
        palette={palette}
        translate={translate}
        onSelect={onSelect}
        onOpen={onOpen}
      />
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        ref={containerRef}
        role="img"
        aria-label={translate('graph.title')}
        className="h-full w-full"
      />
      {model.graph.order > 0 && (
        <GraphViewportControls
          zoom={zoom}
          translate={translate}
          onZoomIn={() => moveCamera(0.72)}
          onZoomOut={() => moveCamera(1.38)}
          onFit={resetCamera}
          onFocus={selectedId ? focusSelection : undefined}
        />
      )}
    </div>
  );
}
