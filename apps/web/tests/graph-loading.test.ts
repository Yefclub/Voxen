import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolveGraphPollingAction } from '../src/client/lib/graph-loading';
import type { GraphIndexStatus } from '../src/shared/graph-index';

function status(state: GraphIndexStatus['state'], runId = 'run-1'): GraphIndexStatus {
  return {
    state,
    runId,
    updatedAt: '2026-07-15T12:00:00.000Z',
  } as GraphIndexStatus;
}

describe('resolveGraphPollingAction', () => {
  test('polls only the lightweight status while indexing is running', () => {
    expect(resolveGraphPollingAction(null, status('running'), false)).toBe('poll-status');
    expect(resolveGraphPollingAction('running', status('running'), true)).toBe('poll-status');
  });

  test('refreshes the full snapshot once after a running job becomes ready', () => {
    expect(resolveGraphPollingAction('running', status('ready'), true)).toBe('refresh-snapshot');
    expect(resolveGraphPollingAction(null, status('ready'), true)).toBe('refresh-snapshot');
    expect(resolveGraphPollingAction(null, status('ready'), false)).toBe('stop');
    expect(resolveGraphPollingAction('ready', status('ready'), false)).toBe('stop');
  });

  test('stops polling on a terminal error instead of looping forever', () => {
    expect(resolveGraphPollingAction('running', status('error'), true)).toBe('stop');
  });
});

describe('graph loading lifecycle contract', () => {
  test('polls the status endpoint instead of scheduling full graph snapshots', () => {
    const pageSource = readFileSync(
      new URL('../src/client/pages/grafo.tsx', import.meta.url),
      'utf8',
    );
    expect(pageSource).toContain("useFetch<GraphIndexStatus>('/api/graph/status')");
    expect(pageSource).toContain('window.setTimeout(refreshIndexStatus, 2_500)');
    expect(pageSource).not.toContain(
      'window.setTimeout(() => setGraphRequest({ tick: Date.now(), force: false })',
    );
  });

  test('opens the sliced map first and retains selection while its node is outside a view', () => {
    const pageSource = readFileSync(
      new URL('../src/client/pages/grafo.tsx', import.meta.url),
      'utf8',
    );

    expect(pageSource).toContain("useState<'map' | 'full'>('map')");
    expect(pageSource).toContain("params.set('view', view)");
    expect(pageSource).toContain('onClick={() => setView(nextView)}');
    expect(pageSource).not.toContain("params.set('view', 'full')");
    expect(pageSource).not.toContain('!filtered.nodes.some((node) => node.id === selectedId)');
  });

  test('exposes the provenance of every visible connection in the inspector', () => {
    const pageSource = readFileSync(
      new URL('../src/client/pages/grafo.tsx', import.meta.url),
      'utf8',
    );

    expect(pageSource).toContain("translate('graph.relationReason'");
    expect(pageSource).toContain("translate('graph.relationMethod'");
    expect(pageSource).toContain("translate('graph.relationConfidence'");
    expect(pageSource).toContain("translate('graph.relationEvidence'");
  });
});
