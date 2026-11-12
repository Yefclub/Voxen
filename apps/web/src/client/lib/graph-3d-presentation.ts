import { createElement, Fragment } from 'react';
import type { NodeRenderer, Theme, Sphere as GraphSphere, Label as GraphLabel } from 'reagraph';
import { toOpaqueGraphColor, type GraphPalette, type SigmaGraphModel } from './graph-model';

/** Keep the overview's marks and type proportional to its world-space extent. */
export function graph3DScale(model: SigmaGraphModel | null): number {
  const points = [...(model?.positions3d.values() ?? [])];
  if (!points.length) return 1;
  return Math.max(
    1,
    ...(['x', 'y', 'z'] as const).map(
      (axis) =>
        (Math.max(...points.map((point) => point[axis])) -
          Math.min(...points.map((point) => point[axis]))) /
        1500,
    ),
  );
}

/** Reuse Reagraph's geometry and billboards without eagerly loading its renderer. */
export function createGraph3DNodeRenderer(
  { Sphere, Label }: { Sphere: typeof GraphSphere; Label: typeof GraphLabel },
  model: SigmaGraphModel,
  palette: GraphPalette,
  coarsePointer: boolean,
): NodeRenderer {
  const fontSize = (coarsePointer ? 60 : 40) * graph3DScale(model);
  const xs = [...model.positions3d.values()].map((point) => point.x);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const extentX = Math.max(...xs) - Math.min(...xs);
  const points = [...model.positions3d.values()];
  const centerY = points.length
    ? (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2
    : 0;
  const centerZ = points.length
    ? (Math.min(...points.map((p) => p.z)) + Math.max(...points.map((p) => p.z))) / 2
    : 0;
  const distance = Math.max(600, extentX * 1.5);
  const offsetX = (x: number): number =>
    x < centerX - extentX * 0.25 ? fontSize * 6 : x > centerX + extentX * 0.25 ? -fontSize * 6 : 0;
  const representatives = new Set<string>();
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
  // Reserve text space in the initial frontal overview; selected names stay available.
  for (const id of model.graph.filterNodes((_id, attributes) => attributes.forceLabel === true)) {
    const point = model.positions3d.get(id);
    if (!point) continue;
    const projection = distance / Math.max(distance * 0.4, distance + centerZ - point.z);
    const label = model.nodeById.get(id)?.label ?? '';
    const box = {
      x: (point.x + offsetX(point.x) - centerX) * projection,
      y: (point.y + fontSize * 1.6 - centerY) * projection,
      width: Math.min(label.length, 20) * fontSize * 0.65 * projection,
      height: fontSize * 2 * projection,
    };
    if (
      occupied.some(
        (other) =>
          Math.abs(box.x - other.x) < (box.width + other.width) / 2 &&
          Math.abs(box.y - other.y) < (box.height + other.height) / 2,
      )
    )
      continue;
    representatives.add(id);
    occupied.push(box);
    if (representatives.size === 6) break;
  }
  return (props) =>
    createElement(
      Fragment,
      null,
      createElement(Sphere, props),
      (props.active || props.selected || representatives.has(props.id)) && props.node.label
        ? createElement(
            'group',
            {
              position: [offsetX(props.node.position.x), props.size + fontSize * 0.8, 0],
              scale: fontSize / 7,
            },
            createElement(Label, {
              text: props.node.label,
              fontSize: 7,
              color: palette.label,
              stroke: palette.labelStroke,
              opacity: props.opacity,
              ellipsis: 20,
              backgroundColor: palette.canvas,
              backgroundOpacity: 0.9,
              padding: 1,
            }),
          )
        : null,
    );
}

export function buildVoxenTheme(baseTheme: Theme, palette: GraphPalette): Theme {
  return {
    ...baseTheme,
    canvas: { background: palette.canvas, fog: null },
    node: {
      ...baseTheme.node,
      fill: palette.nodes.content,
      activeFill: palette.activeNode,
      opacity: 1,
      selectedOpacity: 1,
      inactiveOpacity: 0.18,
      label: {
        color: palette.label,
        stroke: palette.labelStroke,
        activeColor: palette.label,
        // A canvas-colored background keeps names readable over colored nodes.
        backgroundColor: palette.canvas,
        backgroundOpacity: 0.88,
        padding: 6,
        radius: 6,
      },
    },
    ring: {
      fill: toOpaqueGraphColor(palette.neutralEdge),
      activeFill: palette.nodes.transcript,
    },
    edge: {
      ...baseTheme.edge,
      fill: toOpaqueGraphColor(palette.neutralEdge),
      activeFill: toOpaqueGraphColor(palette.label),
      opacity: 1,
      selectedOpacity: 1,
      inactiveOpacity: 0.05,
      label: {
        color: palette.label,
        activeColor: palette.label,
        stroke: palette.labelStroke,
      },
    },
    arrow: {
      fill: toOpaqueGraphColor(palette.neutralEdge),
      activeFill: toOpaqueGraphColor(palette.label),
    },
    lasso: baseTheme.lasso,
  };
}
