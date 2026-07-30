import { describe, expect, test } from 'bun:test';
import type { JobSummary } from './types';
import {
  createDeferredJobRefresh,
  reconcileClosedJobStreams,
  reconcileJobSummaries,
} from './job-list-reconciliation';

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 'job-1',
    status: 'RUNNING',
    sourceUrl: 'https://example.com/video',
    errorMsg: null,
    transcriptId: null,
    queuedAt: '2026-07-30T10:00:00.000Z',
    startedAt: '2026-07-30T10:00:01.000Z',
    finishedAt: null,
    progressStage: 'transcribing',
    progressPercent: 40,
    ...overrides,
  };
}

describe('reconciliação da lista de jobs', () => {
  test('snapshot semanticamente igual preserva array e itens anteriores', () => {
    const current = [
      job({
        events: [
          {
            id: 'event-1',
            jobId: 'job-1',
            stage: 'transcribing',
            percent: 40,
            ts: '2026-07-30T10:00:02.000Z',
          },
        ],
      }),
    ];
    const incoming = structuredClone(current);

    const reconciled = reconcileJobSummaries(current, incoming);

    expect(reconciled).toBe(current);
    expect(reconciled[0]).toBe(current[0]);
  });

  test('troca somente o item cujo estado semântico mudou', () => {
    const first = job();
    const second = job({ id: 'job-2', progressPercent: 10 });
    const current = [first, second];
    const incoming = [
      structuredClone(first),
      job({ id: 'job-2', progressPercent: 70, progressStage: 'summarizing' }),
    ];

    const reconciled = reconcileJobSummaries(current, incoming);

    expect(reconciled).not.toBe(current);
    expect(reconciled[0]).toBe(first);
    expect(reconciled[1]).toBe(incoming[1]);
  });

  test('preserva itens ao reordenar sem conservar a ordem antiga', () => {
    const first = job();
    const second = job({ id: 'job-2' });

    const reconciled = reconcileJobSummaries(
      [first, second],
      [structuredClone(second), structuredClone(first)],
    );

    expect(reconciled.map((item) => item.id)).toEqual(['job-2', 'job-1']);
    expect(reconciled[0]).toBe(second);
    expect(reconciled[1]).toBe(first);
  });
});

describe('reconciliação das conexões em tempo real', () => {
  test('qualquer stream fechado mantém o fallback ativo', () => {
    const firstClosed = reconcileClosedJobStreams(new Set(), 'job-1', true);
    const secondClosed = reconcileClosedJobStreams(firstClosed, 'job-2', true);
    const firstRecovered = reconcileClosedJobStreams(secondClosed, 'job-1', false);

    expect([...firstRecovered]).toEqual(['job-2']);
    expect(firstRecovered.size).toBe(1);
  });

  test('desativa o fallback somente depois que todos os streams se recuperam', () => {
    const bothClosed = new Set(['job-1', 'job-2']);
    const oneRecovered = reconcileClosedJobStreams(bothClosed, 'job-1', false);
    const allRecovered = reconcileClosedJobStreams(oneRecovered, 'job-2', false);

    expect(oneRecovered.size).toBe(1);
    expect(allRecovered.size).toBe(0);
    expect(reconcileClosedJobStreams(allRecovered, 'job-2', false)).toBe(allRecovered);
  });

  test('deduplica eventos terminais e cancela o timer pendente', () => {
    let scheduled: (() => void) | null = null;
    let schedules = 0;
    let cancels = 0;
    let refreshes = 0;
    const deferred = createDeferredJobRefresh(
      400,
      (callback) => {
        scheduled = callback;
        schedules += 1;
        return schedules;
      },
      () => {
        cancels += 1;
      },
    );

    deferred.schedule(() => {
      refreshes += 1;
    });
    deferred.schedule(() => {
      refreshes += 1;
    });
    expect(schedules).toBe(1);

    (scheduled as (() => void) | null)?.();
    expect(refreshes).toBe(1);

    deferred.schedule(() => {
      refreshes += 1;
    });
    deferred.cancel();
    expect(schedules).toBe(2);
    expect(cancels).toBe(1);
  });
});
