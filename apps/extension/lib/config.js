/**
 * Helpers puros de configuração da extensão Voxen.
 */

/**
 * @param {string} raw
 * @returns {{ ok: true, baseUrl: string } | { ok: false, error: string }}
 */
export function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe a URL base da sua instância Voxen.' };
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, error: 'Use http:// ou https://.' };
    }
  }

  const candidate = schemeMatch ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'URL inválida.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Use http:// ou https://.' };
  }

  if (!url.hostname) {
    return { ok: false, error: 'URL sem host.' };
  }

  return { ok: true, baseUrl: url.origin };
}

/**
 * @param {string} baseUrl
 * @returns {string | null}
 */
export function originPattern(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

/**
 * @param {string} baseUrl
 * @param {string} [nextPath]
 */
export function loginUrl(baseUrl, nextPath = '/fila') {
  const next = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
  return `${baseUrl.replace(/\/$/, '')}/entrar?next=${encodeURIComponent(next)}`;
}

/**
 * @param {string} baseUrl
 */
export function jobsAutoUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/api/jobs/auto`;
}

/**
 * @param {string} baseUrl
 * @param {string} jobId
 */
export function jobStatusUrl(baseUrl, jobId) {
  return `${baseUrl.replace(/\/$/, '')}/api/jobs/${encodeURIComponent(jobId)}`;
}

/**
 * @param {string} baseUrl
 */
export function extensionVersionUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/extension/version.json`;
}

/**
 * GET /api/me — usada só para descobrir o tema do usuário logado (cookie de
 * sessão do browser). Nunca envia/expõe token Bearer aqui.
 * @param {string} baseUrl
 */
export function meUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/api/me`;
}

/**
 * Rota admin de cookies de plataforma (spec 121).
 * @param {string} baseUrl
 */
export function platformCookiesUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/api/admin/integrations/cookies`;
}

/**
 * @param {string} baseUrl
 * @param {string} platform
 */
export function platformCookieUrl(baseUrl, platform) {
  return `${platformCookiesUrl(baseUrl)}/${encodeURIComponent(platform)}`;
}

/**
 * @param {string} baseUrl
 * @param {string} jobId
 */
export function jobPageUrl(baseUrl, jobId) {
  return `${baseUrl.replace(/\/$/, '')}/jobs/${encodeURIComponent(jobId)}`;
}

/**
 * @param {string} baseUrl
 * @param {string} transcriptId
 */
export function transcriptPageUrl(baseUrl, transcriptId) {
  return `${baseUrl.replace(/\/$/, '')}/transcricoes/${encodeURIComponent(transcriptId)}`;
}

/**
 * @param {string | undefined} tabUrl
 */
export function isSendableTabUrl(tabUrl) {
  if (!tabUrl || typeof tabUrl !== 'string') return false;
  try {
    const u = new URL(tabUrl);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Heurística: aba parece ser uma instância Voxen (paths conhecidos).
 * @param {string | undefined} tabUrl
 * @param {string | undefined} tabTitle
 */
export function looksLikeVoxenTab(tabUrl, tabTitle) {
  if (!isSendableTabUrl(tabUrl)) return false;
  try {
    const u = new URL(tabUrl);
    const path = u.pathname || '/';
    const known =
      path === '/' ||
      path.startsWith('/transcricoes') ||
      path.startsWith('/fila') ||
      path.startsWith('/extensao') ||
      path.startsWith('/grafo') ||
      path.startsWith('/chat') ||
      path.startsWith('/notas') ||
      path.startsWith('/entrar') ||
      path.startsWith('/admin');
    if (known) return true;
    if (typeof tabTitle === 'string' && /\bvoxen\b/i.test(tabTitle)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Versão embutida no package (espelha manifest). */
export const EXTENSION_VERSION = '0.4.0';
