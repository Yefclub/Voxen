import { describe, expect, test } from 'bun:test';
import { Children, createElement, Fragment, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGraph3DNodeRenderer } from './graph-3d-presentation';
import { buildSigmaGraphModel, resolveGraphPalette, type GraphNode } from './graph-model';

describe('3D overview labels', () => {
  test('keeps a selected source identifiable even when it has no overview label', () => {
    const source: GraphNode = {
      id: 'isolated',
      key: 'content:isolated',
      type: 'content',
      label: 'A source to open',
      description: null,
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 1,
      updatedAt: '2026-11-12',
    };
    const model = buildSigmaGraphModel({
      nodes: [source],
      edges: [],
      totalNodes: 1,
      totalEdges: 0,
    });
    const modules = {
      Sphere: () => null,
      Label: ({ text }: { text: string }) => createElement('span', null, text),
    };
    const render = createGraph3DNodeRenderer(modules, model, resolveGraphPalette('light'), true);
    const props: Parameters<typeof render>[0] = {
      id: source.id,
      color: '#777',
      size: 32,
      active: false,
      selected: false,
      opacity: 1,
      animated: false,
      node: {
        id: source.id,
        label: source.label,
        position: { id: source.id, data: {}, links: [], index: 0, vx: 0, vy: 0, x: 0, y: 0, z: 0 },
        parents: [],
        data: {},
      },
    };
    const markup = (selected: boolean): string =>
      renderToStaticMarkup(createElement(Fragment, null, render({ ...props, selected })));
    expect(markup(false)).not.toContain(source.label);
    expect(markup(true)).toContain(source.label);
  });
  test('places an upper-boundary label below its marker without changing marker geometry', () => {
    const nodes: GraphNode[] = ['upper', 'lower'].map((id) => ({
      id,
      key: `content:${id}`,
      type: 'content',
      label: id,
      description: null,
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 1,
      updatedAt: '2026-11-12',
    }));
    const model = buildSigmaGraphModel({ nodes, edges: [], totalNodes: 2, totalEdges: 0 });
    model.positions3d = new Map([
      ['upper', { x: 0, y: 600, z: 0 }],
      ['lower', { x: 0, y: -600, z: 0 }],
    ]);
    const modules = { Sphere: () => null, Label: () => null };
    const render = createGraph3DNodeRenderer(modules, model, resolveGraphPalette('light'), false);
    const position = {
      id: 'upper',
      data: {},
      links: [],
      index: 0,
      vx: 0,
      vy: 0,
      x: 0,
      y: 600,
      z: 0,
    };
    const result = render({
      id: 'upper',
      color: '#777',
      size: 36,
      active: false,
      selected: true,
      opacity: 1,
      animated: false,
      node: { id: 'upper', label: 'Upper source', position },
    });
    if (!isValidElement<{ children: React.ReactNode }>(result))
      throw new Error('Missing node scene');
    const children = Children.toArray(result.props.children).filter(isValidElement);
    const labelGroup = children.find((child) => child.type === 'group');
    const marker = children.find((child) => child.type === modules.Sphere);
    expect(labelGroup).toBeDefined();
    expect((labelGroup!.props as { position: number[] }).position[1]).toBeLessThan(0);
    expect((marker!.props as { size: number }).size).toBe(36);
    expect((marker!.props as { node: { position: unknown } }).node.position).toBe(position);
  });
});
