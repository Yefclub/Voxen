import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  GRAPH_DEFERRED_MAX_POLLS,
  GRAPH_DEFERRED_POLL_INTERVAL_MS,
  GRAPH_STATUS_POLL_INTERVAL_MS,
  graphIndexState,
  graphStatusPollDelay,
  isGraphDeferredRetryDue,
  isGraphIndexDeferred,
  resolveGraphPollingAction,
} from '../src/client/lib/graph-loading';
import {
  GraphIndexRunError,
  createGraphIndexFailureStatus,
  reportGraphIndexRunFailure,
} from '../src/lib/graph-index-run-error';
import type { GraphIndexStatus } from '../src/shared/graph-index';

afterEach(() => mock.restore());

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
    expect(resolveGraphPollingAction(status('running'), status('running'), true)).toBe(
      'poll-status',
    );
  });

  test('refreshes the full snapshot once after a running job becomes ready', () => {
    expect(resolveGraphPollingAction(status('running'), status('ready'), true)).toBe(
      'refresh-snapshot',
    );
    expect(resolveGraphPollingAction(null, status('ready'), true)).toBe('refresh-snapshot');
    expect(resolveGraphPollingAction(null, status('ready'), false)).toBe('stop');
    expect(resolveGraphPollingAction(status('ready'), status('ready'), false)).toBe('stop');
  });

  test('stops polling on a terminal error instead of looping forever', () => {
    expect(resolveGraphPollingAction(status('running'), status('error'), true)).toBe('stop');
  });

  test('keeps observing partial coverage until the automatic retry converges', () => {
    expect(
      resolveGraphPollingAction(
        status('running'),
        { ...status('error'), reason: 'coverage-incomplete', recoverable: true },
        true,
      ),
    ).toBe('poll-status');
  });

  test('refreshes the snapshot when deferred coverage becomes ready', () => {
    const deferred = {
      ...status('error'),
      reason: 'coverage-incomplete' as const,
      recoverable: true,
    };
    expect(resolveGraphPollingAction(deferred, status('ready'), false)).toBe('refresh-snapshot');
  });
});

describe('graphStatusPollDelay', () => {
  const deferred: GraphIndexStatus = {
    ...status('error'),
    reason: 'coverage-incomplete',
    recoverable: true,
    retryAfter: '2026-07-15T12:05:00.000Z',
  };

  test('uses the short interval only while indexing is active', () => {
    expect(graphStatusPollDelay(status('running'), 0)).toBe(GRAPH_STATUS_POLL_INTERVAL_MS);
    expect(graphStatusPollDelay(status('ready'), 0)).toBeNull();
    expect(graphStatusPollDelay(status('error'), 0)).toBeNull();
  });

  test('waits for the server retry window before observing deferred coverage', () => {
    expect(graphStatusPollDelay(deferred, 0, Date.parse('2026-07-15T12:00:00.000Z'))).toBe(300_000);
  });

  test('caps follow-up polls when deferred coverage does not converge', () => {
    const afterRetry = Date.parse('2026-07-15T12:05:01.000Z');
    expect(graphStatusPollDelay(deferred, 0, afterRetry)).toBe(GRAPH_DEFERRED_POLL_INTERVAL_MS);
    expect(graphStatusPollDelay(deferred, GRAPH_DEFERRED_MAX_POLLS - 1, afterRetry)).toBe(
      GRAPH_DEFERRED_POLL_INTERVAL_MS,
    );
    expect(graphStatusPollDelay(deferred, GRAPH_DEFERRED_MAX_POLLS, afterRetry)).toBeNull();
  });

  test('treats a missing or invalid retry window as due and still caps polling', () => {
    const withoutRetry = { ...deferred, retryAfter: undefined };
    const invalidRetry = { ...deferred, retryAfter: 'invalid' };
    expect(isGraphDeferredRetryDue(withoutRetry)).toBe(true);
    expect(isGraphDeferredRetryDue(invalidRetry)).toBe(true);
    expect(graphStatusPollDelay(withoutRetry, GRAPH_DEFERRED_MAX_POLLS)).toBeNull();
    expect(graphStatusPollDelay(invalidRetry, GRAPH_DEFERRED_MAX_POLLS)).toBeNull();
  });
});

describe('recoverable graph coverage', () => {
  test('renders deferred coverage independently from terminal failure and empty readiness', () => {
    expect(graphIndexState(false, true, false, true)).toBe('deferred');
    expect(graphIndexState(false, false, true, true)).toBe('failed');
    expect(graphIndexState(false, false, false, true)).toBe('ready');
    expect(graphIndexState(false, false, false, false)).toBeNull();
  });

  test('distinguishes expected partial coverage from a real indexing failure', () => {
    expect(
      isGraphIndexDeferred({
        ...status('error'),
        reason: 'coverage-incomplete',
        recoverable: true,
      }),
    ).toBe(true);
    expect(
      isGraphIndexDeferred({
        ...status('error'),
        reason: 'coverage-incomplete',
      }),
    ).toBe(false);
    expect(isGraphIndexDeferred({ ...status('error'), reason: 'failed' })).toBe(false);
    expect(
      isGraphIndexDeferred({ ...status('error'), reason: 'redis-unavailable', recoverable: true }),
    ).toBe(false);
    expect(
      isGraphIndexDeferred({ ...status('error'), reason: 'lease-lost', recoverable: true }),
    ).toBe(false);
    expect(isGraphIndexDeferred(null)).toBe(false);
    expect(isGraphIndexDeferred(undefined)).toBe(false);
  });

  test('publishes partial coverage as recoverable with the normal retry cooldown', () => {
    expect(
      createGraphIndexFailureStatus(
        status('running'),
        'coverage-incomplete',
        Date.parse('2026-07-15T12:00:00.000Z'),
        300_000,
      ),
    ).toMatchObject({
      state: 'error',
      reason: 'coverage-incomplete',
      recoverable: true,
      retryAfter: '2026-07-15T12:05:00.000Z',
    });
  });

  test('logs partial coverage as an observable deferred pass without a warning stack', () => {
    const info = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new GraphIndexRunError('coverage-incomplete', {
      expectedSourceNodes: 4,
      indexedSourceNodes: 3,
      staleSourceNodes: 0,
    });

    expect(reportGraphIndexRunFailure('user-1', error)).toBe('coverage-incomplete');
    expect(info).toHaveBeenCalledWith(
      `${JSON.stringify({
        level: 'info',
        event: 'graph-reindex-deferred',
        userId: 'user-1',
        expectedSourceNodes: 4,
        indexedSourceNodes: 3,
        staleSourceNodes: 0,
      })}\n`,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('graph loading lifecycle contract', () => {
  test('opens the complete graph by default and keeps selection independent of filtering', () => {
    const pageSource = readFileSync(
      new URL('../src/client/pages/grafo.tsx', import.meta.url),
      'utf8',
    );

    expect(pageSource).toContain("params.set('view', 'full')");
    expect(pageSource).not.toContain("useState<'map' | 'full'>('map')");
    expect(pageSource).not.toContain("params.set('view', view)");
    expect(pageSource).not.toContain('onClick={() => setView(nextView)}');
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

  test('uses server-side search to focus nodes outside the rendered snapshot', () => {
    const pageSource = readFileSync(
      new URL('../src/client/pages/grafo.tsx', import.meta.url),
      'utf8',
    );
    const searchSource = readFileSync(
      new URL('../src/client/components/graph-server-search.tsx', import.meta.url),
      'utf8',
    );

    expect(pageSource).toContain('/api/graph/search?q=');
    expect(pageSource).toContain("params.set('focus', focusedGraphId)");
    expect(pageSource).toContain('onSelect={selectSearchResult}');
    expect(pageSource).toContain('new Set(current).add(node.type)');
    expect(searchSource).toContain('data-testid="graph-clear-server-focus"');
    expect(searchSource).toContain("translate('graph.clearFocus')");
  });
});
