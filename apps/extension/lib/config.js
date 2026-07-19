/**
 * Helpers puros de configuração da extensão Voxen.
 * Usados no popup/options/background e testados via bun test.
 */

/**
 * Normaliza a base URL da instância (sem path trailing, com scheme).
 * @param {string} raw
 * @returns {{ ok: true, baseUrl: string } | { ok: false, error: string }}
 */
export function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe a URL base da sua instância Voxen.' };
  }

  // Scheme explícito que não seja http(s) → rejeita (evita `ftp://x` virar
  // `https://ftp://x` se só checássemos ausência de http).
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

  // Remove path/query/hash — a base é só origin (+ porta).
  const baseUrl = url.origin;
  return { ok: true, baseUrl };
}

/**
 * Origem exata para chrome.permissions (scheme + host + porta).
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
 * Monta URL de login com retorno relativo seguro.
 * @param {string} baseUrl
 * @param {string} [nextPath]
 */
export function loginUrl(baseUrl, nextPath = '/fila') {
  const next = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
  return `${baseUrl.replace(/\/$/, '')}/entrar?next=${encodeURIComponent(next)}`;
}

/**
 * Endpoint unificado de ingestão.
 * @param {string} baseUrl
 */
export function jobsAutoUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/api/jobs/auto`;
}

/**
 * Valida se a aba atual pode ser enviada (http/https).
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
