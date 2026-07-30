import { describe, expect, test } from 'bun:test';
import {
  jobProgressSnapshot,
  reconcileJobProgress,
  type JobProgressState,
} from './jobs-queue-section';

describe('progresso reconciliado da fila', () => {
  test('projeta etapa e percentual do snapshot recebido pelo polling', () => {
    expect(
      jobProgressSnapshot({
        id: 'job-1',
        status: 'RUNNING',
        progressStage: 'summarizing',
        progressPercent: 73,
        progressedAt: '2026-07-30T08:00:00.000Z',
      }),
    ).toEqual({
      jobId: 'job-1',
      stage: 'summarizing',
      percent: 73,
      progressedAt: Date.parse('2026-07-30T08:00:00.000Z'),
    });
  });

  test('usa o status como fallback e limita percentuais inválidos', () => {
    expect(
      jobProgressSnapshot({
        id: 'job-1',
        status: 'QUEUED',
        progressStage: null,
        progressPercent: null,
        progressedAt: null,
      }),
    ).toEqual({ jobId: 'job-1', stage: 'queued', percent: 0, progressedAt: 0 });
    expect(
      jobProgressSnapshot({
        id: 'job-1',
        status: 'RUNNING',
        progressStage: 'transcribing',
        progressPercent: 140,
        progressedAt: 'inválido',
      }),
    ).toEqual({ jobId: 'job-1', stage: 'transcribing', percent: 100, progressedAt: 0 });
  });

  test('não deixa polling antigo sobrescrever progresso SSE mais recente', () => {
    const fromSse: JobProgressState = {
      jobId: 'job-1',
      stage: 'summarizing',
      percent: 70,
      progressedAt: Date.parse('2026-07-30T08:00:10.000Z'),
    };
    const stalePolling: JobProgressState = {
      jobId: 'job-1',
      stage: 'transcribing',
      percent: 40,
      progressedAt: Date.parse('2026-07-30T08:00:05.000Z'),
    };

    expect(reconcileJobProgress(fromSse, stalePolling)).toBe(fromSse);
  });

  test('aceita snapshot de polling realmente mais recente e reinicia em outro job', () => {
    const current: JobProgressState = {
      jobId: 'job-1',
      stage: 'transcribing',
      percent: 40,
      progressedAt: Date.parse('2026-07-30T08:00:05.000Z'),
    };
    const newer: JobProgressState = {
      jobId: 'job-1',
      stage: 'summarizing',
      percent: 80,
      progressedAt: Date.parse('2026-07-30T08:00:10.000Z'),
    };
    const otherJob = { ...current, jobId: 'job-2', percent: 0, progressedAt: 0 };

    expect(reconcileJobProgress(current, newer)).toBe(newer);
    expect(reconcileJobProgress(newer, otherJob)).toBe(otherJob);
  });
});
