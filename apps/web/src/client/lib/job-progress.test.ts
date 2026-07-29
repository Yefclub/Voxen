import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatJobElapsed,
  isJobProgressSnapshot,
  jobElapsedMs,
  jobProgressEventDurationMs,
  jobProgressEventKey,
  mergeJobProgressEvents,
} from './job-progress';

const first = { id: 'event-1', jobId: 'job-1', stage: 'queued', ts: '2026-07-29T10:00:00.000Z' };
const second = { id: 'event-2', jobId: 'job-1', stage: 'running', ts: '2026-07-29T10:01:00.000Z' };

describe('job progress reconciliation', () => {
  test('reconhece somente snapshots com lista de eventos', () => {
    expect(isJobProgressSnapshot({ jobId: 'job-1', stage: 'running', events: [] })).toBe(true);
    expect(isJobProgressSnapshot({ jobId: 'job-1', stage: 'running' })).toBe(false);
  });

  test('deduplica snapshot e SSE pela identidade estável do evento', () => {
    const initial = [first];
    expect(mergeJobProgressEvents(initial, [first])).toBe(initial);
    expect(mergeJobProgressEvents(initial, [first, second])).toEqual([first, second]);
    expect(jobProgressEventKey(first)).toBe('event-1');
  });
});

describe('duração operacional do job', () => {
  test('usa o instante atual enquanto ativo e o término quando concluído', () => {
    expect(jobElapsedMs('2026-07-29T12:00:00.000Z', null, Date.parse('2026-07-29T12:01:05Z'))).toBe(
      65_000,
    );
    expect(
      jobElapsedMs(
        '2026-07-29T12:00:00.000Z',
        '2026-07-29T13:02:03.000Z',
        Date.parse('2026-07-30T00:00:00Z'),
      ),
    ).toBe(3_723_000);
  });

  test('formata minutos e horas sem depender do fuso', () => {
    expect(formatJobElapsed(65_000)).toBe('1:05');
    expect(formatJobElapsed(3_723_000)).toBe('1:02:03');
  });

  test('mede cada evento até o próximo evento ou até o instante terminal', () => {
    expect(
      jobProgressEventDurationMs([first, second], 0, null, Date.parse('2026-07-29T10:03:00Z')),
    ).toBe(60_000);
    expect(
      jobProgressEventDurationMs(
        [first, second],
        1,
        '2026-07-29T10:01:42Z',
        Date.parse('2026-07-29T10:03:00Z'),
      ),
    ).toBe(42_000);
  });
});

describe('movimento reduzido na timeline', () => {
  test('desliga deslocamentos, tempos e pulsos decorativos', () => {
    const page = readFileSync(join(import.meta.dir, '../pages/jobs-detalhe.tsx'), 'utf8');
    expect(page).toContain('const reduceMotion = useReducedMotion()');
    expect(page).toContain('initial={reduceMotion ? false');
    expect(page).toContain('duration: reduceMotion ? 0');
    expect(page).toContain("reduceMotion ? '' : ' animate-ping'");
    expect(page).toContain("reduceMotion ? '' : ' animate-pulse'");
  });
});
