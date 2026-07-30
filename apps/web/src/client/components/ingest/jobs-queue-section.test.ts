import { describe, expect, test } from 'bun:test';
import { jobProgressSnapshot } from './jobs-queue-section';

describe('progresso reconciliado da fila', () => {
  test('projeta etapa e percentual do snapshot recebido pelo polling', () => {
    expect(
      jobProgressSnapshot({
        status: 'RUNNING',
        progressStage: 'summarizing',
        progressPercent: 73,
      }),
    ).toEqual({ stage: 'summarizing', percent: 73 });
  });

  test('usa o status como fallback e limita percentuais inválidos', () => {
    expect(
      jobProgressSnapshot({
        status: 'QUEUED',
        progressStage: null,
        progressPercent: null,
      }),
    ).toEqual({ stage: 'queued', percent: 0 });
    expect(
      jobProgressSnapshot({
        status: 'RUNNING',
        progressStage: 'transcribing',
        progressPercent: 140,
      }),
    ).toEqual({ stage: 'transcribing', percent: 100 });
  });
});
