/**
 * Estado do job entre aberturas do popup.
 *
 * No MV3 o documento do popup é destruído assim que ele perde o foco — tudo
 * que estava em memória morre junto. Quem sobrevive é o `chrome.storage.local`
 * mantido pelo service worker: `trackedJobs` (jobs em andamento, já usados
 * para notificar) e `lastJobOutcome` (resultado final ainda não visto pelo
 * usuário). Este módulo é a única fonte de verdade sobre esse estado e
 * concentra a lógica pura para que ela seja testável sem browser.
 */

/**
 * @typedef {{
 *   jobId: string,
 *   baseUrl: string,
 *   token?: string,
 *   pageTitle?: string,
 *   startedAt?: number,
 *   lastSeenAt?: number,
 * }} TrackedJob
 *
 * @typedef {{
 *   jobId: string,
 *   outcome: 'succeeded' | 'failed',
 *   baseUrl: string,
 *   title: string | null,
 *   summary: string | null,
 *   transcriptId: string | null,
 *   errorMsg: string | null,
 *   finishedAt: number,
 * }} JobOutcome
 */

export const TRACKED_JOBS_KEY = 'trackedJobs';
export const LAST_OUTCOME_KEY = 'lastJobOutcome';

/** Depois disso o resultado deixa de ser "recente" e não reaparece no popup. */
export const OUTCOME_TTL_MS = 30 * 60 * 1000;

/**
 * Teto de **estagnação** de um job rastreado. Sem isso o rastreamento é
 * eterno: o worker só despeja a entrada em estado terminal ou em 401, e
 * qualquer outro erro (job apagado no servidor, instância trocada nas opções e
 * o `baseUrl` velho nunca mais responder) deixa um zumbi para sempre no
 * `chrome.storage.local`.
 *
 * O prazo conta a partir do **último sinal de vida** — o enfileiramento ou a
 * última consulta em que o servidor confirmou o job em andamento —, não do
 * início absoluto. Tempo de vida absoluto mataria job legítimo: numa fila com
 * backlog (dezenas de vídeos longos à frente), o último da fila estoura o
 * prazo parado em `QUEUED` mesmo com o servidor reportando-o vivo a cada
 * consulta. Contando estagnação, o zumbi inalcançável morre igual e o job que
 * o servidor confirma vivo nunca morre.
 */
export const TRACKED_JOB_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Classifica o status cru da API. Qualquer coisa que não seja terminal conta
 * como "em andamento" — status desconhecido nunca é apresentado como
 * concluído nem como falha.
 * @param {string | undefined | null} status
 * @returns {'succeeded' | 'failed' | 'pending'}
 */
export function classifyJobStatus(status) {
  const normalized = String(status ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'SUCCEEDED' || normalized === 'DONE' || normalized === 'COMPLETED') {
    return 'succeeded';
  }
  if (normalized === 'FAILED' || normalized === 'CANCELLED') return 'failed';
  return 'pending';
}

/**
 * Job em andamento mais recente entre os rastreados (o popup mostra um só).
 * @param {Record<string, TrackedJob> | undefined | null} trackedJobs
 * @returns {TrackedJob | null}
 */
export function pickActiveJob(trackedJobs) {
  const entries = Object.values(trackedJobs || {}).filter(
    (job) =>
      job &&
      typeof job === 'object' &&
      typeof job.jobId === 'string' &&
      job.jobId !== '' &&
      typeof job.baseUrl === 'string' &&
      job.baseUrl !== '',
  );
  if (entries.length === 0) return null;
  return entries.reduce((newest, job) =>
    (Number(job.startedAt) || 0) > (Number(newest.startedAt) || 0) ? job : newest,
  );
}

/**
 * Último instante em que se soube algo do job: `lastSeenAt` quando alguma
 * consulta já confirmou o job em andamento, senão o carimbo do
 * enfileiramento.
 * @param {unknown} job
 * @returns {number}
 */
function lastSignalAt(job) {
  const source = /** @type {TrackedJob} */ (job || {});
  const lastSeen = Number(source.lastSeenAt);
  if (Number.isFinite(lastSeen) && lastSeen > 0) return lastSeen;
  return Number(source.startedAt);
}

/**
 * Um job sem sinal de vida há tempo demais é tratado como perdido. Entrada sem
 * carimbo utilizável também conta como expirada: só `trackJob` escreve o mapa
 * e ele sempre grava `startedAt`, então o que chega aqui sem ele é resto
 * corrompido — mantê-lo é exatamente o zumbi que o TTL existe para matar.
 * @param {unknown} job
 * @param {number} now
 * @returns {boolean}
 */
function isExpiredJob(job, now) {
  const reference = lastSignalAt(job);
  if (!Number.isFinite(reference) || reference <= 0) return true;
  return now - reference > TRACKED_JOB_TTL_MS;
}

/**
 * Cópia do mapa de rastreamento sem os jobs que estouraram o TTL.
 * @param {Record<string, TrackedJob> | undefined | null} trackedJobs
 * @param {number} now
 * @returns {Record<string, TrackedJob>}
 */
export function pruneExpiredJobs(trackedJobs, now) {
  /** @type {Record<string, TrackedJob>} */
  const next = {};
  for (const [id, job] of Object.entries(trackedJobs || {})) {
    if (!isExpiredJob(job, now)) next[id] = job;
  }
  return next;
}

/**
 * O popup mostra um desfecho só. Quando mais de um job termina na mesma
 * rodada de poll, o escolhido é o do job iniciado mais recentemente — mesmo
 * critério de `pickActiveJob`, para que a escolha não dependa da ordem de
 * iteração do mapa. Os demais não somem para o usuário: cada um gera a sua
 * própria notificação.
 * @param {Array<{ startedAt?: number, outcome: JobOutcome }>} candidates
 * @returns {JobOutcome | null}
 */
export function pickLatestOutcome(candidates) {
  const list = (candidates || []).filter((c) => c && c.outcome);
  if (list.length === 0) return null;
  return list.reduce((newest, c) =>
    (Number(c.startedAt) || 0) > (Number(newest.startedAt) || 0) ? c : newest,
  ).outcome;
}

/**
 * Cópia do mapa com o sinal de vida renovado nos jobs informados — o servidor
 * acabou de confirmá-los em andamento, então o relógio de estagnação zera.
 *
 * Ids ausentes do mapa são ignorados de propósito: um job que o popup
 * reconheceu (ou que já foi removido) durante a rodada não pode voltar por
 * aqui.
 * @param {Record<string, TrackedJob> | undefined | null} trackedJobs
 * @param {Iterable<string>} jobIds
 * @param {number} now
 * @returns {Record<string, TrackedJob>}
 */
export function touchJobs(trackedJobs, jobIds, now) {
  /** @type {Record<string, TrackedJob>} */
  const next = { ...(trackedJobs || {}) };
  for (const id of jobIds || []) {
    const job = next[id];
    if (!job || typeof job !== 'object') continue;
    next[id] = { ...job, lastSeenAt: now };
  }
  return next;
}

/**
 * Cópia do mapa de rastreamento sem o job informado (sem mutar o original).
 * @param {Record<string, TrackedJob> | undefined | null} trackedJobs
 * @param {string} jobId
 * @returns {Record<string, TrackedJob>}
 */
export function withoutJob(trackedJobs, jobId) {
  const next = { ...(trackedJobs || {}) };
  delete next[jobId];
  return next;
}

/**
 * Converte o status terminal de um job no resultado guardado para a próxima
 * abertura do popup. Retorna `null` enquanto o job não for terminal.
 * @param {{ job: any, tracked?: Partial<TrackedJob>, now?: number }} input
 * @returns {JobOutcome | null}
 */
export function buildJobOutcome({ job, tracked, now }) {
  if (!job || typeof job !== 'object') return null;
  const kind = classifyJobStatus(job.status);
  if (kind === 'pending') return null;

  const source = tracked || {};
  const jobId = typeof source.jobId === 'string' && source.jobId ? source.jobId : String(job.id);
  const title = job.title || source.pageTitle || null;

  return {
    jobId,
    outcome: kind,
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : '',
    title,
    summary: job.summary || null,
    transcriptId: typeof job.transcriptId === 'string' ? job.transcriptId : null,
    errorMsg: typeof job.errorMsg === 'string' ? job.errorMsg : null,
    finishedAt: typeof now === 'number' ? now : Date.now(),
  };
}

/**
 * @param {unknown} outcome
 * @param {number} now
 * @returns {outcome is JobOutcome}
 */
function isFreshOutcome(outcome, now) {
  if (!outcome || typeof outcome !== 'object') return false;
  const candidate = /** @type {JobOutcome} */ (outcome);
  if (candidate.outcome !== 'succeeded' && candidate.outcome !== 'failed') return false;
  if (typeof candidate.jobId !== 'string' || !candidate.jobId) return false;
  if (typeof candidate.finishedAt !== 'number') return false;
  return now - candidate.finishedAt <= OUTCOME_TTL_MS;
}

/**
 * O que o popup deve mostrar ao abrir, dado o estado persistido.
 * @param {{
 *   trackedJobs?: Record<string, TrackedJob> | null,
 *   lastOutcome?: unknown,
 *   now?: number,
 * }} [input]
 * @returns {{ kind: 'idle' }
 *   | { kind: 'tracking', job: TrackedJob }
 *   | { kind: 'outcome', outcome: JobOutcome }}
 */
export function selectPopupState(input) {
  const { trackedJobs, lastOutcome, now } = input || {};
  const at = typeof now === 'number' ? now : Date.now();

  // Jobs vencidos não restauram nada: um rastreamento que nunca resolve não
  // pode continuar governando a tela de um popup aberto meses depois.
  const active = pickActiveJob(pruneExpiredJobs(trackedJobs, at));
  if (active) return { kind: 'tracking', job: active };

  if (isFreshOutcome(lastOutcome, at)) {
    return { kind: 'outcome', outcome: /** @type {JobOutcome} */ (lastOutcome) };
  }

  return { kind: 'idle' };
}

/**
 * Estado do botão de envio do popup, por fase.
 *
 * A regra que importa: **só uma fase que comprovadamente ocupa o envio pode
 * desabilitar o botão**. Estado desconhecido (`unavailable` — instância fora
 * do ar, job irresolvível) não é ocupação: o usuário continua podendo
 * enfileirar outra página. Amarrar o botão a um acompanhamento que pode nunca
 * resolver deixa a extensão inutilizável sem caminho de recuperação.
 * @param {{
 *   phase: 'idle' | 'sending' | 'tracking' | 'unavailable' | 'succeeded' | 'failed',
 *   sendable: boolean,
 * }} input
 * @returns {{ disabled: boolean, label: string }}
 */
export function submitButtonState({ phase, sendable }) {
  const canSend = sendable === true;
  switch (phase) {
    case 'sending':
      return { disabled: true, label: 'Enviando…' };
    case 'tracking':
      return { disabled: true, label: 'Salvo — processando' };
    case 'unavailable':
    case 'succeeded':
      return { disabled: !canSend, label: 'Salvar outro' };
    case 'failed':
      return { disabled: !canSend, label: 'Tentar de novo' };
    default:
      return { disabled: !canSend, label: 'Salvar no Voxen' };
  }
}
