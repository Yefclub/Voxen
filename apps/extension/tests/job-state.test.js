import { describe, expect, test } from 'bun:test';
import {
  OUTCOME_TTL_MS,
  buildJobOutcome,
  classifyJobStatus,
  pickActiveJob,
  selectPopupState,
  withoutJob,
} from '../lib/job-state.js';

describe('classifyJobStatus', () => {
  test('estados terminais de sucesso', () => {
    expect(classifyJobStatus('SUCCEEDED')).toBe('succeeded');
    expect(classifyJobStatus('DONE')).toBe('succeeded');
    expect(classifyJobStatus('COMPLETED')).toBe('succeeded');
    expect(classifyJobStatus('done')).toBe('succeeded');
  });

  test('estados terminais de falha', () => {
    expect(classifyJobStatus('FAILED')).toBe('failed');
    expect(classifyJobStatus('CANCELLED')).toBe('failed');
  });

  test('estados em andamento', () => {
    expect(classifyJobStatus('QUEUED')).toBe('pending');
    expect(classifyJobStatus('RUNNING')).toBe('pending');
  });

  test('estado desconhecido ou vazio conta como em andamento', () => {
    expect(classifyJobStatus('WHATEVER')).toBe('pending');
    expect(classifyJobStatus('')).toBe('pending');
    expect(classifyJobStatus(undefined)).toBe('pending');
  });
});

describe('pickActiveJob', () => {
  test('sem jobs rastreados retorna null', () => {
    expect(pickActiveJob(undefined)).toBeNull();
    expect(pickActiveJob({})).toBeNull();
  });

  test('escolhe o job mais recente', () => {
    const tracked = {
      a: { jobId: 'a', baseUrl: 'https://v.example', startedAt: 100 },
      b: { jobId: 'b', baseUrl: 'https://v.example', startedAt: 300 },
      c: { jobId: 'c', baseUrl: 'https://v.example', startedAt: 200 },
    };
    expect(pickActiveJob(tracked)?.jobId).toBe('b');
  });

  test('ignora entradas malformadas', () => {
    const tracked = {
      bad: null,
      worse: { startedAt: 999 },
      good: { jobId: 'good', baseUrl: 'https://v.example', startedAt: 1 },
    };
    expect(pickActiveJob(tracked)?.jobId).toBe('good');
  });

  test('entrada sem baseUrl não é restaurável', () => {
    expect(pickActiveJob({ x: { jobId: 'x', startedAt: 5 } })).toBeNull();
  });
});

describe('withoutJob', () => {
  test('remove sem mutar o original', () => {
    const tracked = { a: { jobId: 'a' }, b: { jobId: 'b' } };
    const next = withoutJob(tracked, 'a');
    expect(Object.keys(next)).toEqual(['b']);
    expect(Object.keys(tracked)).toEqual(['a', 'b']);
  });

  test('job inexistente devolve cópia equivalente', () => {
    const tracked = { a: { jobId: 'a' } };
    expect(withoutJob(tracked, 'zzz')).toEqual(tracked);
    expect(withoutJob(undefined, 'zzz')).toEqual({});
  });
});

describe('buildJobOutcome', () => {
  const tracked = {
    jobId: 'j1',
    baseUrl: 'https://v.example',
    pageTitle: 'Título da aba',
    startedAt: 10,
  };

  test('job em andamento não vira resultado', () => {
    expect(buildJobOutcome({ job: { id: 'j1', status: 'RUNNING' }, tracked, now: 50 })).toBeNull();
  });

  test('sucesso carrega título, resumo e transcriptId', () => {
    const outcome = buildJobOutcome({
      job: {
        id: 'j1',
        status: 'SUCCEEDED',
        title: 'Artigo salvo',
        summary: 'Resumo do artigo.',
        transcriptId: 't9',
      },
      tracked,
      now: 500,
    });
    expect(outcome).toEqual({
      jobId: 'j1',
      outcome: 'succeeded',
      baseUrl: 'https://v.example',
      title: 'Artigo salvo',
      summary: 'Resumo do artigo.',
      transcriptId: 't9',
      errorMsg: null,
      finishedAt: 500,
    });
  });

  test('sucesso sem título usa o título da aba rastreada', () => {
    const outcome = buildJobOutcome({
      job: { id: 'j1', status: 'DONE' },
      tracked,
      now: 500,
    });
    expect(outcome?.title).toBe('Título da aba');
    expect(outcome?.transcriptId).toBeNull();
  });

  test('falha carrega a mensagem de erro', () => {
    const outcome = buildJobOutcome({
      job: { id: 'j1', status: 'FAILED', errorMsg: 'yt-dlp explodiu' },
      tracked,
      now: 700,
    });
    expect(outcome?.outcome).toBe('failed');
    expect(outcome?.errorMsg).toBe('yt-dlp explodiu');
  });

  test('usa o id do job quando o rastreamento não tem jobId', () => {
    const outcome = buildJobOutcome({
      job: { id: 'j2', status: 'CANCELLED' },
      tracked: { baseUrl: 'https://v.example' },
      now: 1,
    });
    expect(outcome?.jobId).toBe('j2');
  });
});

describe('selectPopupState', () => {
  const job = { jobId: 'j1', baseUrl: 'https://v.example', pageTitle: 'x', startedAt: 10 };
  const outcome = {
    jobId: 'j0',
    outcome: 'succeeded',
    baseUrl: 'https://v.example',
    title: 'Pronto',
    summary: 'Resumo',
    transcriptId: 't1',
    errorMsg: null,
    finishedAt: 1000,
  };

  test('sem job e sem resultado recente: estado inicial', () => {
    expect(selectPopupState({ trackedJobs: {}, lastOutcome: null, now: 1000 })).toEqual({
      kind: 'idle',
    });
    expect(selectPopupState({})).toEqual({ kind: 'idle' });
  });

  test('job em andamento restaura o progresso', () => {
    const state = selectPopupState({ trackedJobs: { j1: job }, lastOutcome: null, now: 2000 });
    expect(state.kind).toBe('tracking');
    expect(state.job.jobId).toBe('j1');
  });

  test('job terminado com popup fechado mostra o resultado', () => {
    const state = selectPopupState({ trackedJobs: {}, lastOutcome: outcome, now: 1500 });
    expect(state.kind).toBe('outcome');
    expect(state.outcome.jobId).toBe('j0');
  });

  test('resultado antigo demais não reaparece', () => {
    const state = selectPopupState({
      trackedJobs: {},
      lastOutcome: outcome,
      now: outcome.finishedAt + OUTCOME_TTL_MS + 1,
    });
    expect(state).toEqual({ kind: 'idle' });
  });

  test('resultado já visto não reaparece', () => {
    const state = selectPopupState({
      trackedJobs: {},
      lastOutcome: { ...outcome, seen: true },
      now: 1500,
    });
    expect(state).toEqual({ kind: 'idle' });
  });

  test('job novo em andamento tem prioridade sobre resultado anterior', () => {
    const state = selectPopupState({
      trackedJobs: { j1: job },
      lastOutcome: outcome,
      now: 1500,
    });
    expect(state.kind).toBe('tracking');
  });

  test('resultado corrompido é ignorado', () => {
    expect(selectPopupState({ trackedJobs: {}, lastOutcome: { jobId: 'x' }, now: 10 })).toEqual({
      kind: 'idle',
    });
    expect(selectPopupState({ trackedJobs: {}, lastOutcome: 'nope', now: 10 })).toEqual({
      kind: 'idle',
    });
  });
});
