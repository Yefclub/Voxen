/**
 * Cliente HTTP da extensão → instância Voxen.
 */

import {
  extensionVersionUrl,
  jobStatusUrl,
  jobsAutoUrl,
  meUrl,
  platformCookieUrl,
  platformCookiesUrl,
} from './config.js';

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
 * GET /api/me — tema do usuário (cosmético) + role (decide se a seção de
 * contas de plataforma aparece). Falha silenciosa (retorna null) em qualquer
 * erro: nunca deve travar o popup/options.
 * @param {string} baseUrl
 * @returns {Promise<{ theme: string, role: string | null } | null>}
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
    const role = typeof body?.user?.role === 'string' ? body.user.role : null;
    return { theme, role };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ platform: string, hasCookie: boolean, capturedAt: string | null, stale: boolean }} PlatformCookieStatus
 */

/**
 * Traduz o status HTTP das rotas admin de cookie num código estável pra UI.
 * @param {number} status
 * @returns {{ code: string, message: string } | null}
 */
function adminHttpFailure(status) {
  if (status === 401) {
    return { code: 'unauthorized', message: 'Entre na instância Voxen e tente de novo.' };
  }
  if (status === 403) {
    return { code: 'forbidden', message: 'Só administradores podem conectar contas.' };
  }
  return null;
}

/**
 * GET /api/admin/integrations/cookies — estado por plataforma. A resposta
 * nunca traz o valor dos cookies (só hasCookie/capturedAt/stale).
 * @param {{ baseUrl: string, token?: string | null }} opts
 */
export async function fetchPlatformCookieStatus(opts) {
  const { baseUrl, token } = opts;
  let res;
  try {
    res = await fetch(platformCookiesUrl(baseUrl), {
      method: 'GET',
      headers: authHeaders(token),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (err) {
    return { ok: false, code: 'network', message: networkError(err).message };
  }

  const failure = adminHttpFailure(res.status);
  if (failure) return { ok: false, ...failure };
  if (!res.ok) {
    return { ok: false, code: 'error', message: `Falha ao consultar contas (HTTP ${res.status}).` };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: 'error', message: 'Resposta inválida da instância.' };
  }
  if (!Array.isArray(body?.platforms)) {
    return { ok: false, code: 'error', message: 'Resposta inválida da instância.' };
  }
  return { ok: true, platforms: body.platforms };
}

/**
 * PATCH /api/admin/integrations/cookies — envia a captura de uma plataforma.
 *
 * O payload é um cookie de sessão de conta real: nenhuma mensagem devolvida
 * daqui pode carregar pedaço dele. Por isso o erro de rede vira texto fixo em
 * vez de repassar `err.message` (que pode conter a URL/corpo da requisição).
 * @param {{ baseUrl: string, platform: string, cookies: string, token?: string | null }} opts
 */
export async function sendPlatformCookies(opts) {
  const { baseUrl, platform, cookies, token } = opts;
  let res;
  try {
    res = await fetch(platformCookiesUrl(baseUrl), {
      method: 'PATCH',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ platform, cookies }),
    });
  } catch {
    return {
      ok: false,
      code: 'network',
      message: 'Não foi possível contactar a instância. O que já estava salvo continua lá.',
    };
  }

  const failure = adminHttpFailure(res.status);
  if (failure) return { ok: false, ...failure };

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.ok && body && typeof body.platform === 'string') {
    return { ok: true, status: /** @type {PlatformCookieStatus} */ (body) };
  }

  const serverMsg =
    body && typeof body.error === 'string'
      ? body.error
      : `Falha ao salvar a conta (HTTP ${res.status}).`;
  return { ok: false, code: 'error', message: serverMsg };
}

/**
 * DELETE /api/admin/integrations/cookies/:platform — revoga a credencial
 * guardada daquela plataforma.
 * @param {{ baseUrl: string, platform: string, token?: string | null }} opts
 */
export async function deletePlatformCookies(opts) {
  const { baseUrl, platform, token } = opts;
  let res;
  try {
    res = await fetch(platformCookieUrl(baseUrl, platform), {
      method: 'DELETE',
      headers: authHeaders(token),
      credentials: 'include',
    });
  } catch {
    return { ok: false, code: 'network', message: 'Não foi possível contactar a instância.' };
  }

  const failure = adminHttpFailure(res.status);
  if (failure) return { ok: false, ...failure };
  if (!res.ok) {
    return { ok: false, code: 'error', message: `Falha ao desconectar (HTTP ${res.status}).` };
  }
  return { ok: true };
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
