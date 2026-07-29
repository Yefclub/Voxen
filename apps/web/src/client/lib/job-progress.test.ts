import { describe, expect, test } from 'bun:test';
import { isJobProgressSnapshot, jobProgressEventKey, mergeJobProgressEvents } from './job-progress';

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
