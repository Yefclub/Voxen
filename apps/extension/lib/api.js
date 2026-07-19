/**
 * Cliente HTTP da extensão → instância Voxen.
 * Preferência: cookies da sessão do browser (credentials: include) após
 * host permission concedida. Token Bearer opcional (futuro / MCP reuse).
 */

import { jobsAutoUrl } from './config.js';

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
 * POST /api/jobs/auto com a URL da aba.
 * @param {{ baseUrl: string, pageUrl: string, token?: string | null }} opts
 * @returns {Promise<SubmitResult>}
 */
export async function submitUrlToVoxen(opts) {
  const { baseUrl, pageUrl, token } = opts;
  const endpoint = jobsAutoUrl(baseUrl);

  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ url: pageUrl }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Chrome costuma reportar CORS/network de forma genérica.
    if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)) {
      return {
        ok: false,
        code: 'network',
        message:
          'Não foi possível contactar a instância. Verifique a URL base, se está online e se a permissão de host foi concedida.',
      };
    }
    return { ok: false, code: 'network', message: msg || 'Erro de rede.' };
  }

  if (res.status === 401) {
    return {
      ok: false,
      code: 'unauthorized',
      status: 401,
      message: 'Não autenticado. Faça login na sua instância Voxen e tente de novo.',
    };
  }

  if (res.status === 403) {
    return {
      ok: false,
      code: 'forbidden',
      status: 403,
      message: 'Conta sem permissão (pendente/rejeitada).',
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

  // 409 = job em andamento ou transcript já existe — tratamos como info útil.
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
        message: `Já existe no acervo (transcript ${body.transcriptId}).`,
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
