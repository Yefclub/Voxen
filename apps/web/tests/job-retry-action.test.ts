import { describe, expect, test } from 'bun:test';
import {
  canRetryJob,
  jobRetryRefusalMessage,
  resolveJobRetryFeedback,
} from '../src/client/lib/job-retry';
import type { JobStatus } from '../src/client/lib/types';

const FALLBACK = 'Não foi possível reprocessar.';

describe('canRetryJob', () => {
  test('libera reprocessamento apenas para jobs com erro ou cancelados', () => {
    expect(canRetryJob('FAILED')).toBe(true);
    expect(canRetryJob('CANCELLED')).toBe(true);
  });

  test('bloqueia jobs ativos ou concluídos', () => {
    for (const status of ['QUEUED', 'RUNNING', 'DONE'] as JobStatus[]) {
      expect(canRetryJob(status)).toBe(false);
    }
  });
});

describe('resolveJobRetryFeedback', () => {
  test('sucesso devolve o novo job enfileirado', () => {
    expect(resolveJobRetryFeedback({ ok: true, jobId: 'job_2' }, FALLBACK)).toEqual({
      kind: 'queued',
      jobId: 'job_2',
    });
  });

  test('recusa preserva o motivo vindo do servidor', () => {
    expect(
      resolveJobRetryFeedback(
        { ok: false, message: 'Esta URL já está sendo processada.' },
        FALLBACK,
      ),
    ).toEqual({ kind: 'refused', message: 'Esta URL já está sendo processada.' });
  });

  test('recusa sem motivo legível cai no texto padrão', () => {
    expect(resolveJobRetryFeedback({ ok: false, message: '   ' }, FALLBACK)).toEqual({
      kind: 'refused',
      message: FALLBACK,
    });
    expect(resolveJobRetryFeedback({ ok: false, message: null }, FALLBACK)).toEqual({
      kind: 'refused',
      message: FALLBACK,
    });
  });

  test('erro de rede sem mensagem do servidor usa o texto padrão', () => {
    expect(jobRetryRefusalMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(jobRetryRefusalMessage('Job não encontrado.', FALLBACK)).toBe('Job não encontrado.');
  });

  test('resposta 2xx sem jobId é tratada como recusa, não como sucesso silencioso', () => {
    expect(resolveJobRetryFeedback({ ok: true, jobId: null }, FALLBACK)).toEqual({
      kind: 'refused',
      message: FALLBACK,
    });
  });
});
