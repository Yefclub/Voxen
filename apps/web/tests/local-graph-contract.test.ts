import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const LOCAL_GRAPH_SOURCE = readFileSync(
  new URL('../src/client/components/library/transcript-knowledge-graph.tsx', import.meta.url),
  'utf8',
);
const SERVER_SEARCH_SOURCE = readFileSync(
  new URL('../src/client/components/graph-server-search.tsx', import.meta.url),
  'utf8',
);
const CONTAINERS_CSS = readFileSync(
  new URL('../src/client/graph-containers.css', import.meta.url),
  'utf8',
);
const OVERLAY_CSS = readFileSync(new URL('../src/client/overlay.css', import.meta.url), 'utf8');

describe('local graph contract (spec 219)', () => {
  test('local graph renders through the shared canvas with tab-free scope control', () => {
    expect(LOCAL_GRAPH_SOURCE).toContain(
      "import { KnowledgeGraphCanvas } from '../graph/knowledge-graph-canvas'",
    );
    expect(LOCAL_GRAPH_SOURCE).toContain('<KnowledgeGraphCanvas');
    expect(LOCAL_GRAPH_SOURCE).toContain("from '../ui/select'");
    expect(LOCAL_GRAPH_SOURCE).toContain("aria-label={t('library.localGraph.scope')}");
    expect(LOCAL_GRAPH_SOURCE).toContain('<SelectContent>');
    expect(LOCAL_GRAPH_SOURCE).not.toContain('aria-pressed');
    expect(LOCAL_GRAPH_SOURCE).not.toContain('buildGraphLayout');
    expect(LOCAL_GRAPH_SOURCE).not.toContain('<svg');
  });

  test('local workspace exposes map and bounded inspector zones', () => {
    expect(LOCAL_GRAPH_SOURCE).toContain('data-local-graph-workspace');
    expect(LOCAL_GRAPH_SOURCE).toContain('data-local-graph-map');
    expect(LOCAL_GRAPH_SOURCE).toContain('data-local-graph-inspector');
    expect(LOCAL_GRAPH_SOURCE).toContain("t('library.localGraph.searchNodes')");
    expect(LOCAL_GRAPH_SOURCE).toContain("t('library.localGraph.backToNodes')");
    expect(LOCAL_GRAPH_SOURCE).toContain('data-node-id');
  });

  test('server search is a Base UI combobox with preserved test hooks', () => {
    expect(SERVER_SEARCH_SOURCE).toContain("from '@base-ui/react/combobox'");
    expect(SERVER_SEARCH_SOURCE).toContain('<Combobox.Root<GraphNode>');
    expect(SERVER_SEARCH_SOURCE).toContain('<Combobox.Input');
    expect(SERVER_SEARCH_SOURCE).toContain('<Combobox.Portal>');
    expect(SERVER_SEARCH_SOURCE).toContain('<Combobox.Empty');
    expect(SERVER_SEARCH_SOURCE).toContain('data-testid="graph-server-search-results"');
    expect(SERVER_SEARCH_SOURCE).toContain('data-testid="graph-clear-server-focus"');
    expect(SERVER_SEARCH_SOURCE).toContain('translate(`graph.node.${node.type}`)');
    expect(SERVER_SEARCH_SOURCE).not.toContain('role="listbox"');
  });

  test('container queries and popup motion live outside the global stylesheet', () => {
    expect(CONTAINERS_CSS).toContain('container: localgraph / inline-size');
    expect(CONTAINERS_CSS).toContain('container: globalgraph / inline-size');
    expect(CONTAINERS_CSS).toContain('.local-graph-inspector');
    expect(CONTAINERS_CSS).toContain('.knowledge-graph-inspector');
    expect(OVERLAY_CSS).toContain('.base-popup[data-starting-style]');
  });

  test('local status covers every compilation state without hiding materialized data', () => {
    for (const state of ['NOT_INDEXED', 'INDEXING', 'PARTIAL', 'FAILED']) {
      expect(LOCAL_GRAPH_SOURCE).toContain(`data.state === '${state}'`);
    }
    expect(LOCAL_GRAPH_SOURCE).toContain('{data.truncated &&');
    expect(LOCAL_GRAPH_SOURCE).toContain('{data.nodes.length === 0 && (');
  });
});
