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
 *   seen?: boolean,
 * }} JobOutcome
 */

export const TRACKED_JOBS_KEY = 'trackedJobs';
export const LAST_OUTCOME_KEY = 'lastJobOutcome';

/** Depois disso o resultado deixa de ser "recente" e não reaparece no popup. */
export const OUTCOME_TTL_MS = 30 * 60 * 1000;

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
  if (candidate.seen === true) return false;
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

  const active = pickActiveJob(trackedJobs);
  if (active) return { kind: 'tracking', job: active };

  if (isFreshOutcome(lastOutcome, at)) {
    return { kind: 'outcome', outcome: /** @type {JobOutcome} */ (lastOutcome) };
  }

  return { kind: 'idle' };
}
