import { describe, expect, test } from 'bun:test';
import { createElement, Fragment } from 'react';
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
});
