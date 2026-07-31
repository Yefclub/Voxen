/**
 * Cliente HTTP da extensão → instância Voxen.
 */

import { extensionVersionUrl, jobStatusUrl, jobsAutoUrl, meUrl } from './config.js';

/**
 * @typedef {'ok' | 'unauthorized' | 'forbidden' | 'network' | 'cors' | 'invalid' | 'error'} SubmitCode
 */

/**
 * @typedef {{
 *   ok: true,
 *   jobId: string,
 *   status?: string,
 *   sourceUrl?: string
 * } | {
 *   ok: false,
 *   code: SubmitCode,
 *   message: string,
 *   status?: number
 * }} SubmitResult
 */

/**
 * @param {string} baseUrl
 * @param {string | null | undefined} token
 * @returns {Record<string, string>}
 */
function authHeaders(token) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * @param {unknown} err
 * @returns {SubmitResult}
 */
function networkError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)) {
    return {
      ok: false,
      code: 'network',
      message:
        'Não foi possível contactar a instância. Confira a URL, se está online e se a permissão de host foi concedida.',
    };
  }
  return { ok: false, code: 'network', message: msg || 'Erro de rede.' };
}

/**
 * POST /api/jobs/auto
 * @param {{ baseUrl: string, pageUrl: string, token?: string | null }} opts
 * @returns {Promise<SubmitResult>}
 */
export async function submitUrlToVoxen(opts) {
  const { baseUrl, pageUrl, token } = opts;
  const endpoint = jobsAutoUrl(baseUrl);
  const headers = {
    ...authHeaders(token),
    'Content-Type': 'application/json',
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ url: pageUrl }),
    });
  } catch (err) {
    return networkError(err);
  }

  if (res.status === 401) {
    return {
      ok: false,
      code: 'unauthorized',
      status: 401,
      message: 'Não autenticado. Entre na instância e tente de novo.',
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      code: 'forbidden',
      status: 403,
      message: 'Conta sem permissão (pendente ou rejeitada).',
    };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 201 && body && typeof body.jobId === 'string') {
    return {
      ok: true,
      jobId: body.jobId,
      status: typeof body.status === 'string' ? body.status : undefined,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
    };
  }

  if (res.status === 409 && body) {
    if (typeof body.jobId === 'string') {
      return {
        ok: true,
        jobId: body.jobId,
        status: 'existing',
        sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
      };
    }
    if (typeof body.transcriptId === 'string') {
      return {
        ok: false,
        code: 'error',
        status: 409,
        message: 'Este conteúdo já está no acervo.',
      };
    }
  }

  const serverMsg =
    body && typeof body.error === 'string'
      ? body.error
      : `Falha ao enfileirar (HTTP ${res.status}).`;

  if (res.status === 400) {
    return { ok: false, code: 'invalid', status: 400, message: serverMsg };
  }
  return { ok: false, code: 'error', status: res.status, message: serverMsg };
}

/**
 * GET /api/jobs/:id — status + título/resumo quando pronto.
 * @param {{ baseUrl: string, jobId: string, token?: string | null }} opts
 */
export async function fetchJobStatus(opts) {
  const { baseUrl, jobId, token } = opts;
  let res;
  try {
    res = await fetch(jobStatusUrl(baseUrl, jobId), {
      method: 'GET',
      headers: authHeaders(token),
      credentials: 'include',
    });
  } catch (err) {
    return { ok: false, code: 'network', message: networkError(err).message };
  }

  if (res.status === 401) {
    return { ok: false, code: 'unauthorized', message: 'Sessão expirada.' };
  }
  if (!res.ok) {
    return { ok: false, code: 'error', message: `HTTP ${res.status}` };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: 'error', message: 'Resposta inválida.' };
  }

  const job = body?.job;
  if (!job || typeof job.id !== 'string') {
    return { ok: false, code: 'error', message: 'Job inválido.' };
  }

  return {
    ok: true,
    job: {
      id: job.id,
      type: typeof job.type === 'string' ? job.type : null,
      status: String(job.status || ''),
      sourceUrl: typeof job.sourceUrl === 'string' ? job.sourceUrl : null,
      errorMsg: typeof job.errorMsg === 'string' ? job.errorMsg : null,
      transcriptId: typeof job.transcriptId === 'string' ? job.transcriptId : null,
      title: typeof job.title === 'string' ? job.title : null,
      summary: typeof job.summary === 'string' ? job.summary : null,
      progressStage: typeof job.progressStage === 'string' ? job.progressStage : null,
      progressPercent: typeof job.progressPercent === 'number' ? job.progressPercent : null,
    },
  };
}

/**
 * GET /api/me — só para descobrir o tema do usuário (sessão via cookie).
 * Falha silenciosa (retorna null) em qualquer erro: tema é cosmético, nunca
 * deve travar o popup/options.
 * @param {string} baseUrl
 * @returns {Promise<{ theme: string } | null>}
 */
export async function fetchMe(baseUrl) {
  try {
    const res = await fetch(meUrl(baseUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    const theme = body?.user?.theme;
    if (typeof theme !== 'string') return null;
    return { theme };
  } catch {
    return null;
  }
}

/**
 * GET /extension/version.json — checagem de update (soft).
 * @param {string} baseUrl
 */
export async function fetchExtensionVersion(baseUrl) {
  try {
    const res = await fetch(extensionVersionUrl(baseUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body.version !== 'string') return null;
    return {
      version: body.version,
      zipUrl: typeof body.zipUrl === 'string' ? body.zipUrl : null,
      pageUrl: typeof body.pageUrl === 'string' ? body.pageUrl : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    };
  } catch {
    return null;
  }
}

/**
 * Compara semver simples a.b.c (0 se iguais, >0 se a>b).
 * @param {string} a
 * @param {string} b
 */
export function compareSemver(a, b) {
  const pa = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
