import { describe, expect, test } from 'bun:test';
import {
  OUTCOME_TTL_MS,
  TRACKED_JOB_TTL_MS,
  buildJobOutcome,
  classifyJobStatus,
  pickActiveJob,
  pickLatestOutcome,
  pruneExpiredJobs,
  selectPopupState,
  submitButtonState,
  touchJobs,
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

describe('pruneExpiredJobs', () => {
  const base = { jobId: 'a', baseUrl: 'https://v.example' };

  test('mantém job dentro do TTL', () => {
    const now = 100_000_000;
    const tracked = { a: { ...base, startedAt: now - TRACKED_JOB_TTL_MS + 1 } };
    expect(Object.keys(pruneExpiredJobs(tracked, now))).toEqual(['a']);
  });

  test('descarta job que estourou o TTL', () => {
    const now = 100_000_000;
    const tracked = { a: { ...base, startedAt: now - TRACKED_JOB_TTL_MS - 1 } };
    expect(pruneExpiredJobs(tracked, now)).toEqual({});
  });

  test('entrada sem startedAt utilizável é descartada', () => {
    const now = 100_000_000;
    expect(pruneExpiredJobs({ a: { ...base } }, now)).toEqual({});
    expect(pruneExpiredJobs({ a: { ...base, startedAt: 0 } }, now)).toEqual({});
    expect(pruneExpiredJobs({ a: { ...base, startedAt: 'ontem' } }, now)).toEqual({});
    expect(pruneExpiredJobs({ a: { ...base, startedAt: Number.NaN } }, now)).toEqual({});
  });

  test('não muta o mapa original e tolera ausência', () => {
    const now = 100_000_000;
    const tracked = { a: { ...base, startedAt: 1 }, b: { ...base, jobId: 'b', startedAt: now } };
    const next = pruneExpiredJobs(tracked, now);
    expect(Object.keys(next)).toEqual(['b']);
    expect(Object.keys(tracked)).toEqual(['a', 'b']);
    expect(pruneExpiredJobs(undefined, now)).toEqual({});
    expect(pruneExpiredJobs(null, now)).toEqual({});
  });

  test('o prazo conta do último sinal de vida, não do início absoluto', () => {
    const now = 100_000_000;
    // Cenário de backlog: enfileirado há muito mais que o TTL, mas o servidor
    // confirmou há pouco que ele continua na fila.
    const tracked = {
      a: {
        ...base,
        startedAt: now - TRACKED_JOB_TTL_MS * 4,
        lastSeenAt: now - 60_000,
      },
    };
    expect(Object.keys(pruneExpiredJobs(tracked, now))).toEqual(['a']);
  });

  test('descarta job cujo último sinal de vida também estourou o prazo', () => {
    const now = 100_000_000;
    const tracked = {
      a: {
        ...base,
        startedAt: now - TRACKED_JOB_TTL_MS * 4,
        lastSeenAt: now - TRACKED_JOB_TTL_MS - 1,
      },
    };
    expect(pruneExpiredJobs(tracked, now)).toEqual({});
  });

  test('lastSeenAt inutilizável cai de volta no startedAt', () => {
    const now = 100_000_000;
    const vivo = { ...base, startedAt: now - 1_000, lastSeenAt: 'ontem' };
    const morto = { ...base, startedAt: now - TRACKED_JOB_TTL_MS - 1, lastSeenAt: 0 };
    expect(Object.keys(pruneExpiredJobs({ a: vivo }, now))).toEqual(['a']);
    expect(pruneExpiredJobs({ a: morto }, now)).toEqual({});
  });
});

describe('touchJobs', () => {
  const base = { jobId: 'a', baseUrl: 'https://v.example', startedAt: 10 };

  test('renova o sinal de vida sem mexer no carimbo de início', () => {
    const next = touchJobs({ a: { ...base } }, ['a'], 999);
    expect(next.a.lastSeenAt).toBe(999);
    expect(next.a.startedAt).toBe(10);
  });

  test('ignora id ausente — job já reconhecido não ressuscita', () => {
    expect(touchJobs({ a: { ...base } }, ['b'], 999)).toEqual({ a: { ...base } });
  });

  test('ignora entrada corrompida e não muta o mapa original', () => {
    const tracked = { a: { ...base }, lixo: null };
    const next = touchJobs(tracked, ['a', 'lixo'], 999);
    expect(next.lixo).toBeNull();
    expect(tracked.a.lastSeenAt).toBeUndefined();
  });

  test('tolera mapa e lista ausentes', () => {
    expect(touchJobs(null, ['a'], 1)).toEqual({});
    expect(touchJobs({ a: { ...base } }, null, 1)).toEqual({ a: { ...base } });
  });
});

/**
 * Regressão do bloqueador: um job rastreado que nunca resolve (instância
 * trocada nas opções, job apagado no servidor, host que não volta) não pode
 * governar o popup para sempre nem prender o botão de envio. As duas metades
 * da defesa: o rastreamento vence (TTL) e "não sei o estado" não desabilita o
 * envio.
 */
describe('job irresolvível não trava o envio', () => {
  const trintaDias = 30 * 24 * 60 * 60 * 1000;
  const now = 1_000_000_000;
  const velho = {
    jobId: 'velho',
    baseUrl: 'https://instancia-antiga.example',
    pageTitle: 'Página de um mês atrás',
    startedAt: now - trintaDias,
  };

  test('job de 30 dias não restaura acompanhamento — popup abre no estado inicial', () => {
    expect(selectPopupState({ trackedJobs: { velho }, lastOutcome: null, now })).toEqual({
      kind: 'idle',
    });
  });

  test('estado inicial deixa o envio liberado numa aba enviável', () => {
    const view = selectPopupState({ trackedJobs: { velho }, lastOutcome: null, now });
    expect(submitButtonState({ phase: view.kind, sendable: true }).disabled).toBe(false);
  });

  test('acompanhamento indisponível libera o envio em vez de prendê-lo', () => {
    expect(submitButtonState({ phase: 'unavailable', sendable: true })).toEqual({
      disabled: false,
      label: 'Salvar outro',
    });
  });

  test('job recente ainda é restaurado — o TTL não engole falha transitória', () => {
    const recente = { ...velho, startedAt: now - 60_000 };
    const view = selectPopupState({ trackedJobs: { recente }, lastOutcome: null, now });
    expect(view.kind).toBe('tracking');
    expect(view.job.jobId).toBe('velho');
  });
});

describe('submitButtonState', () => {
  test('estado inicial segue a aba', () => {
    expect(submitButtonState({ phase: 'idle', sendable: true })).toEqual({
      disabled: false,
      label: 'Salvar no Voxen',
    });
    expect(submitButtonState({ phase: 'idle', sendable: false })).toEqual({
      disabled: true,
      label: 'Salvar no Voxen',
    });
  });

  test('envio em curso e job confirmado em andamento ocupam o botão', () => {
    expect(submitButtonState({ phase: 'sending', sendable: true }).disabled).toBe(true);
    expect(submitButtonState({ phase: 'tracking', sendable: true }).disabled).toBe(true);
  });

  test('desfechos liberam o botão com o rótulo certo', () => {
    expect(submitButtonState({ phase: 'succeeded', sendable: true })).toEqual({
      disabled: false,
      label: 'Salvar outro',
    });
    expect(submitButtonState({ phase: 'failed', sendable: true })).toEqual({
      disabled: false,
      label: 'Tentar de novo',
    });
  });

  test('aba não enviável desabilita em toda fase que não ocupa o botão', () => {
    for (const phase of ['idle', 'unavailable', 'succeeded', 'failed']) {
      expect(submitButtonState({ phase, sendable: false }).disabled).toBe(true);
    }
  });

  test('só sending e tracking podem prender uma aba enviável', () => {
    const fases = ['idle', 'sending', 'tracking', 'unavailable', 'succeeded', 'failed', 'ruído'];
    const presas = fases.filter((phase) => submitButtonState({ phase, sendable: true }).disabled);
    expect(presas).toEqual(['sending', 'tracking']);
  });

  test('fase desconhecida cai no estado inicial em vez de travar', () => {
    expect(submitButtonState({ phase: undefined, sendable: true })).toEqual({
      disabled: false,
      label: 'Salvar no Voxen',
    });
    expect(submitButtonState({ phase: 'tracking', sendable: 'talvez' }).disabled).toBe(true);
    expect(submitButtonState({ phase: 'idle', sendable: 'talvez' }).disabled).toBe(true);
  });
});

describe('pickLatestOutcome', () => {
  const mk = (jobId) => ({
    jobId,
    outcome: 'succeeded',
    baseUrl: 'https://v.example',
    title: jobId,
    summary: null,
    transcriptId: null,
    errorMsg: null,
    finishedAt: 500,
  });

  test('sem candidatos retorna null', () => {
    expect(pickLatestOutcome([])).toBeNull();
    expect(pickLatestOutcome(undefined)).toBeNull();
  });

  test('escolhe o desfecho do job iniciado mais recentemente', () => {
    const chosen = pickLatestOutcome([
      { startedAt: 100, outcome: mk('a') },
      { startedAt: 300, outcome: mk('b') },
      { startedAt: 200, outcome: mk('c') },
    ]);
    expect(chosen?.jobId).toBe('b');
  });

  test('a escolha não depende da ordem da lista', () => {
    const candidatos = [
      { startedAt: 300, outcome: mk('b') },
      { startedAt: 100, outcome: mk('a') },
    ];
    expect(pickLatestOutcome(candidatos)?.jobId).toBe('b');
    expect(pickLatestOutcome([...candidatos].reverse())?.jobId).toBe('b');
  });

  test('ignora candidatos vazios e tolera startedAt ausente', () => {
    const chosen = pickLatestOutcome([null, { startedAt: undefined, outcome: mk('a') }]);
    expect(chosen?.jobId).toBe('a');
  });
});
