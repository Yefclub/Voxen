/**
 * Concorrência do service worker (`background.js`).
 *
 * Os demais testes da extensão exercitam funções puras. Estes exercitam o
 * `background.js` de verdade, porque os requisitos que eles cobrem só existem
 * na costura entre as três peças — o lock, a releitura pós-rede e o filtro
 * `hasOwn` — e cada uma delas é independentemente necessária: derrubar
 * qualquer uma ressuscita um desfecho já reconhecido ou perde um envio
 * recém-enfileirado. O modo de falha é corrida intermitente, do tipo que só
 * aparece em produção, então precisa de rede sob controle do teste.
 *
 * Como o harness funciona (sem browser, sem `mock.module`):
 *
 * - `globalThis.chrome` é um dublê instalado ANTES do import do
 *   `background.js`. O worker não exporta nada — as funções são alcançadas
 *   pelos listeners que ele registra (`onMessage`, `onAlarm`), exatamente como
 *   o Chrome faria.
 * - `chrome.storage.local` guarda cópias via `structuredClone`, igual ao
 *   storage real. Devolver por referência faria os cenários de escrita
 *   passarem mesmo com o código quebrado — falso negativo.
 * - `globalThis.fetch` devolve promessas que só resolvem quando o teste manda.
 *   É isso que permite dizer "esta mensagem chega COM a rodada em voo".
 * - `Date.now` fica sob controle do teste, para provar prazo sem esperar.
 * - Sinal de término: cada operação do worker (`trackJob`, `settleJob`, uma
 *   rodada de poll) termina em exatamente um `chrome.action.setBadgeText`.
 *   Contar essas chamadas é mais confiável do que esperar N microtasks.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { LAST_OUTCOME_KEY, TRACKED_JOBS_KEY, TRACKED_JOB_TTL_MS } from '../lib/job-state.js';

const BASE = 'https://voxen.example.com';
const TRACK_ALARM = 'voxen-job-track';

/* -------------------------------------------------------------------------- */
/* Relógio                                                                     */
/* -------------------------------------------------------------------------- */

const realDateNow = Date.now;
let clock = 1_700_000_000_000;

/** @param {number} ms */
function advanceClock(ms) {
  clock += ms;
}

/* -------------------------------------------------------------------------- */
/* Dublê de chrome.storage                                                     */
/* -------------------------------------------------------------------------- */

function createStorageArea() {
  /** @type {Record<string, unknown>} */
  let data = {};
  /** @type {{ key: string, run: () => Promise<void> | void } | null} */
  let beforeSetOnce = null;

  return {
    /** @param {Record<string, unknown>} [initial] */
    reset(initial) {
      data = structuredClone(initial || {});
      beforeSetOnce = null;
    },
    snapshot() {
      return structuredClone(data);
    },
    /**
     * Dispara uma única vez, imediatamente antes do `set` que gravar `key`.
     * É o gancho que coloca uma segunda operação exatamente dentro da janela
     * ler-alterar-gravar da primeira.
     * @param {string} key
     * @param {() => Promise<void> | void} run
     */
    onceBeforeSet(key, run) {
      beforeSetOnce = { key, run };
    },
    /** @param {string[] | string | Record<string, unknown> | null} [keys] */
    async get(keys) {
      const list = Array.isArray(keys)
        ? keys
        : typeof keys === 'string'
          ? [keys]
          : Object.keys(keys || data);
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const key of list) {
        if (Object.hasOwn(data, key)) out[key] = structuredClone(data[key]);
      }
      return out;
    },
    /** @param {Record<string, unknown>} items */
    async set(items) {
      if (beforeSetOnce && Object.hasOwn(items, beforeSetOnce.key)) {
        const { run } = beforeSetOnce;
        beforeSetOnce = null;
        await run();
      }
      for (const [key, value] of Object.entries(items)) {
        data[key] = structuredClone(value);
      }
    },
  };
}

const local = createStorageArea();
const sync = createStorageArea();

/* -------------------------------------------------------------------------- */
/* Dublê de chrome                                                             */
/* -------------------------------------------------------------------------- */

/** @type {Array<(alarm: { name: string }) => void>} */
const alarmListeners = [];
/** @type {Array<(m: any, s: any, r: (v?: unknown) => void) => boolean>} */
const messageListeners = [];
/** @type {string[]} */
const badgeTexts = [];
/** @type {Array<{ id: string, title: string }>} */
const notifications = [];
/** @type {string[]} */
const clearedAlarms = [];

globalThis.chrome = /** @type {any} */ ({
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      /** @param {(m: any, s: any, r: (v?: unknown) => void) => boolean} fn */
      addListener(fn) {
        messageListeners.push(fn);
      },
    },
    openOptionsPage() {},
  },
  alarms: {
    onAlarm: {
      /** @param {(alarm: { name: string }) => void} fn */
      addListener(fn) {
        alarmListeners.push(fn);
      },
    },
    create() {},
    /** @param {string} name */
    clear(name) {
      clearedAlarms.push(name);
    },
  },
  notifications: {
    onClicked: { addListener() {} },
    /** @param {string} id @param {{ title: string }} opts */
    create(id, opts) {
      notifications.push({ id, title: opts.title });
    },
  },
  action: {
    /** @param {{ text: string }} opts */
    async setBadgeText(opts) {
      badgeTexts.push(opts.text);
    },
    async setBadgeBackgroundColor() {},
  },
  tabs: { create() {} },
  storage: { local, sync },
});

/* -------------------------------------------------------------------------- */
/* Dublê de fetch                                                              */
/* -------------------------------------------------------------------------- */

/** @type {Map<string, { resolve: (r: Response) => void, reject: (e: unknown) => void }>} */
const inflight = new Map();
/** @type {string[]} */
const requestedIds = [];

const realFetch = globalThis.fetch;

/** @param {string | URL | Request} input */
function fakeFetch(input) {
  const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
  const jobId = decodeURIComponent(url.split('/').pop() || '');
  requestedIds.push(jobId);
  return new Promise((resolve, reject) => {
    inflight.set(jobId, { resolve, reject });
  });
}

/**
 * Resolve uma consulta em voo com a resposta da API.
 * @param {string} jobId
 * @param {Record<string, unknown>} job
 */
function respondWithJob(jobId, job) {
  const pending = inflight.get(jobId);
  if (!pending) throw new Error(`nenhuma consulta em voo para ${jobId}`);
  inflight.delete(jobId);
  pending.resolve(
    new Response(JSON.stringify({ job: { id: jobId, ...job } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Espera                                                                      */
/* -------------------------------------------------------------------------- */

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @param {number} n */
async function ticks(n) {
  for (let i = 0; i < n; i++) await tick();
}

/**
 * @param {() => boolean} predicate
 * @param {string} what
 */
async function waitFor(predicate, what) {
  for (let i = 0; i < 2000; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`tempo esgotado esperando: ${what}`);
}

/** @param {string} jobId */
function waitForRequest(jobId) {
  return waitFor(() => inflight.has(jobId), `consulta de ${jobId} entrar em voo`);
}

/** Cada operação do worker termina em exatamente um `setBadgeText`. */
async function waitForOperations(count) {
  await waitFor(() => badgeTexts.length >= count, `${count} operação(ões) do worker terminarem`);
  await ticks(5);
}

/* -------------------------------------------------------------------------- */
/* Disparadores                                                                */
/* -------------------------------------------------------------------------- */

function firePollAlarm() {
  for (const listener of alarmListeners) listener({ name: TRACK_ALARM });
}

/**
 * Envia uma mensagem como o popup faria. A promessa resolve quando o worker
 * chama `sendResponse` — ou seja, quando a operação terminou.
 * @param {{ type: string, payload?: unknown }} message
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      if (listener(message, {}, resolve)) return;
    }
    resolve(undefined);
  });
}

/**
 * @param {string} jobId
 * @param {Partial<{ startedAt: number, lastSeenAt: number, pageTitle: string }>} [overrides]
 */
function trackedJob(jobId, overrides = {}) {
  return {
    jobId,
    baseUrl: BASE,
    token: '',
    pageTitle: `Página ${jobId}`,
    startedAt: clock,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

// O dublê de `chrome` precisa existir antes de o módulo avaliar (ele registra
// os listeners no topo). Por isso import dinâmico, depois da montagem acima.
await import('../background.js');

beforeEach(() => {
  clock = 1_700_000_000_000;
  Date.now = () => clock;
  globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (fakeFetch));
  local.reset({});
  sync.reset({ baseUrl: BASE });
  inflight.clear();
  requestedIds.length = 0;
  badgeTexts.length = 0;
  notifications.length = 0;
  clearedAlarms.length = 0;
});

afterEach(async () => {
  // Drena a fila interna do worker para que nada de um teste vaze no próximo.
  await ticks(20);
  Date.now = realDateNow;
  globalThis.fetch = realFetch;
});

afterAll(() => {
  Date.now = realDateNow;
  globalThis.fetch = realFetch;
});

describe('desfecho reconhecido pelo popup durante uma rodada em voo', () => {
  test('reconhecimento na fase de rede: o desfecho não volta ao storage', async () => {
    local.reset({ [TRACKED_JOBS_KEY]: { j1: trackedJob('j1') } });

    firePollAlarm();
    await waitForRequest('j1');

    // O popup viu o resultado e mandou descartar — com a consulta ainda em voo.
    await sendMessage({ type: 'job-settled', payload: { jobId: 'j1' } });

    respondWithJob('j1', { status: 'DONE', title: 'Vídeo', transcriptId: 't1' });
    await waitForOperations(2);

    const stored = local.snapshot();
    expect(stored[TRACKED_JOBS_KEY]).toEqual({});
    expect(stored[LAST_OUTCOME_KEY] ?? null).toBeNull();
  });

  test('reconhecimento na fase de gravação: o desfecho não volta ao storage', async () => {
    local.reset({ [TRACKED_JOBS_KEY]: { j1: trackedJob('j1') } });

    /** @type {Promise<unknown> | null} */
    let settled = null;
    // Agora a mensagem chega no ponto mais estreito: entre a releitura e a
    // gravação da rodada. Sem o lock, o `set` da rodada passa por cima do
    // reconhecimento; com ele, o reconhecimento espera a vez e prevalece.
    local.onceBeforeSet(TRACKED_JOBS_KEY, async () => {
      settled = sendMessage({ type: 'job-settled', payload: { jobId: 'j1' } });
      await ticks(20);
    });

    firePollAlarm();
    await waitForRequest('j1');
    respondWithJob('j1', { status: 'DONE', title: 'Vídeo', transcriptId: 't1' });
    await waitForOperations(2);
    await settled;

    const stored = local.snapshot();
    expect(stored[TRACKED_JOBS_KEY]).toEqual({});
    expect(stored[LAST_OUTCOME_KEY] ?? null).toBeNull();
  });
});

describe('envio enfileirado durante uma rodada em voo', () => {
  test('enfileiramento na fase de rede: o job novo sobrevive à rodada', async () => {
    local.reset({ [TRACKED_JOBS_KEY]: { j1: trackedJob('j1') } });

    firePollAlarm();
    await waitForRequest('j1');

    await sendMessage({
      type: 'track-job',
      payload: { jobId: 'j2', baseUrl: BASE, pageTitle: 'Página nova' },
    });

    respondWithJob('j1', { status: 'DONE', title: 'Vídeo', transcriptId: 't1' });
    await waitForOperations(2);

    const stored = local.snapshot();
    expect(Object.keys(stored[TRACKED_JOBS_KEY])).toEqual(['j2']);
    // Contraprova: o filtro que descarta desfecho reconhecido não pode
    // descartar desfecho legítimo — j1 ainda estava rastreado.
    expect(stored[LAST_OUTCOME_KEY]).toMatchObject({ jobId: 'j1', outcome: 'succeeded' });
  });

  test('enfileiramento na fase de gravação: o job novo sobrevive à rodada', async () => {
    local.reset({ [TRACKED_JOBS_KEY]: { j1: trackedJob('j1') } });

    /** @type {Promise<unknown> | null} */
    let tracked = null;
    local.onceBeforeSet(TRACKED_JOBS_KEY, async () => {
      tracked = sendMessage({
        type: 'track-job',
        payload: { jobId: 'j2', baseUrl: BASE, pageTitle: 'Página nova' },
      });
      await ticks(20);
    });

    firePollAlarm();
    await waitForRequest('j1');
    respondWithJob('j1', { status: 'DONE' });
    await waitForOperations(2);
    await tracked;

    const stored = local.snapshot();
    expect(Object.keys(stored[TRACKED_JOBS_KEY])).toEqual(['j2']);
  });
});

describe('rodada com mais de um desfecho', () => {
  test('vence o job iniciado mais recentemente, não o último consultado', async () => {
    // Ordem adversa de propósito: o mais antigo é consultado por último, então
    // um critério "o último ganha" escolheria errado.
    local.reset({
      [TRACKED_JOBS_KEY]: {
        recente: trackedJob('recente', { startedAt: clock - 1_000 }),
        antigo: trackedJob('antigo', { startedAt: clock - 60_000 }),
      },
    });

    firePollAlarm();
    await waitForRequest('recente');
    respondWithJob('recente', { status: 'DONE', title: 'Mais novo', transcriptId: 't-novo' });

    await waitForRequest('antigo');
    respondWithJob('antigo', { status: 'DONE', title: 'Mais velho', transcriptId: 't-velho' });

    await waitForOperations(1);

    const stored = local.snapshot();
    expect(stored[TRACKED_JOBS_KEY]).toEqual({});
    expect(stored[LAST_OUTCOME_KEY]).toMatchObject({ jobId: 'recente' });
    // Nenhum desfecho some para o usuário: cada um gerou a sua notificação.
    expect(notifications.map((n) => n.id).sort()).toEqual(['done-antigo', 'done-recente']);
  });
});

describe('prazo de estagnação do rastreamento', () => {
  test('job sem sinal de vida além do prazo é descartado sem consultar o servidor', async () => {
    local.reset({
      [TRACKED_JOBS_KEY]: {
        zumbi: trackedJob('zumbi', { startedAt: clock - TRACKED_JOB_TTL_MS - 1 }),
      },
    });

    firePollAlarm();
    await waitForOperations(1);

    expect(requestedIds).toEqual([]);
    expect(local.snapshot()[TRACKED_JOBS_KEY]).toEqual({});
    expect(badgeTexts.at(-1)).toBe('');
    expect(clearedAlarms).toContain(TRACK_ALARM);
  });

  test('job confirmado em andamento renova o sinal de vida e escapa da poda da própria rodada', async () => {
    // Fica a um segundo do prazo quando a rodada começa — cenário do backlog:
    // dezenas de vídeos longos à frente e este parado em QUEUED há horas.
    local.reset({
      [TRACKED_JOBS_KEY]: {
        jFila: trackedJob('jFila', { startedAt: clock - TRACKED_JOB_TTL_MS + 1_000 }),
      },
    });

    firePollAlarm();
    await waitForRequest('jFila');

    // A fase de rede demora o bastante para o prazo absoluto estourar no meio.
    advanceClock(60_000);
    respondWithJob('jFila', { status: 'QUEUED' });
    await waitForOperations(1);

    const stored = local.snapshot();
    expect(Object.keys(stored[TRACKED_JOBS_KEY])).toEqual(['jFila']);
    expect(stored[TRACKED_JOBS_KEY].jFila.lastSeenAt).toBe(clock);
    // O carimbo de início não muda: ele ordena qual job o popup mostra.
    expect(stored[TRACKED_JOBS_KEY].jFila.startedAt).toBe(
      clock - 60_000 - TRACKED_JOB_TTL_MS + 1_000,
    );
    expect(badgeTexts.at(-1)).toBe('1');
  });

  test('renovação não ressuscita job reconhecido pelo popup durante a rodada', async () => {
    local.reset({ [TRACKED_JOBS_KEY]: { j1: trackedJob('j1') } });

    firePollAlarm();
    await waitForRequest('j1');
    await sendMessage({ type: 'job-settled', payload: { jobId: 'j1' } });
    respondWithJob('j1', { status: 'RUNNING' });
    await waitForOperations(2);

    expect(local.snapshot()[TRACKED_JOBS_KEY]).toEqual({});
  });
});
