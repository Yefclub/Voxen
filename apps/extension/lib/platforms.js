/**
 * Plataformas de conteúdo suportadas na captura de cookies (spec 121) e
 * serialização em formato Netscape (`cookies.txt`) — o mesmo formato que o
 * worker já entrega ao yt-dlp via `cookiefile`.
 *
 * Regras do formato, todas exercidas em tests/platforms.test.js:
 *   - 7 campos separados por TAB, nesta ordem:
 *     domain, includeSubdomains, path, secure, expires, name, value
 *   - flags em MAIÚSCULAS (`TRUE`/`FALSE`)
 *   - `expires` em segundos, só dígitos: sinal/notação-e fazem o yt-dlp pular
 *     a entrada com warning (o cookie some em silêncio). Fração o yt-dlp
 *     aceita, mas emitimos inteiro — é o que o Chrome dá e é mais estrito.
 *   - cookie de sessão → `0`
 *
 * O prefixo `#HttpOnly_` NÃO é emitido de propósito: a flag não tem efeito no
 * uso que o yt-dlp faz do arquivo, então é variação de formato sem ganho.
 * (Ambos os parsers suportam o prefixo — inclusive o `MozillaCookieJar` da
 * stdlib, via `HTTPONLY_PREFIX`. A justificativa anterior, de que a stdlib
 * descartaria a linha, era falsa. Ver spec 121, D5.)
 */

export const NETSCAPE_HEADER = '# Netscape HTTP Cookie File';

/**
 * @typedef {{
 *   id: 'tiktok' | 'instagram' | 'youtube',
 *   label: string,
 *   cookieDomain: string,
 *   origins: string[],
 *   loginUrl: string,
 *   sessionCookieNames: string[]
 * }} Platform
 */

/**
 * `cookieDomain` é o domínio passado a `chrome.cookies.getAll({ domain })` —
 * o Chromium já inclui subdomínios nesse match.
 *
 * YouTube fica restrito a `youtube.com`: cookies de `google.com` cobrem a
 * conta Google inteira (Gmail, Drive…) e não são necessários pro caso de uso.
 * @type {Platform[]}
 */
export const PLATFORMS = [
  {
    id: 'tiktok',
    label: 'TikTok',
    cookieDomain: 'tiktok.com',
    origins: ['https://*.tiktok.com/*'],
    loginUrl: 'https://www.tiktok.com/login',
    sessionCookieNames: ['sessionid', 'sessionid_ss', 'sid_tt'],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    cookieDomain: 'instagram.com',
    origins: ['https://*.instagram.com/*'],
    loginUrl: 'https://www.instagram.com/accounts/login/',
    sessionCookieNames: ['sessionid', 'ds_user_id'],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    cookieDomain: 'youtube.com',
    origins: ['https://*.youtube.com/*'],
    loginUrl: 'https://www.youtube.com/',
    sessionCookieNames: ['LOGIN_INFO', 'SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID'],
  },
];

/**
 * @param {string} id
 * @returns {Platform | null}
 */
export function platformById(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}

/**
 * Match de domínio de cookie contra o domínio da plataforma: igual ou
 * subdomínio. `eviltiktok.com` NÃO casa com `tiktok.com`.
 * @param {string} cookieDomain
 * @param {string} platformDomain
 * @returns {boolean}
 */
export function cookieBelongsToPlatform(cookieDomain, platformDomain) {
  const raw = String(cookieDomain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  const base = String(platformDomain ?? '')
    .trim()
    .toLowerCase();
  if (!raw || !base) return false;
  return raw === base || raw.endsWith(`.${base}`);
}

/**
 * Só os cookies que realmente pertencem ao domínio da plataforma. O
 * `chrome.cookies.getAll({ domain })` já filtra, mas repetir aqui é barato e
 * garante que nada de outro site entre no arquivo enviado ao Voxen.
 * @param {Array<Record<string, unknown>>} cookies
 * @param {Platform} platform
 */
export function filterPlatformCookies(cookies, platform) {
  return (cookies ?? []).filter(
    (c) =>
      typeof c?.domain === 'string' && cookieBelongsToPlatform(c.domain, platform.cookieDomain),
  );
}

/**
 * Heurística de "usuário logado nesta plataforma": presença de pelo menos um
 * dos cookies de sessão conhecidos. É heurística mesmo — as plataformas mudam
 * nomes de cookie sem aviso; a lista em `sessionCookieNames` é o que se sabe
 * hoje. Sem nenhum deles a extensão avisa "nenhuma sessão encontrada" e não
 * envia nada ao backend (requisito da spec 121).
 * @param {Array<Record<string, unknown>>} cookies
 * @param {Platform} platform
 */
export function hasSessionCookie(cookies, platform) {
  const names = new Set(platform.sessionCookieNames);
  return (cookies ?? []).some(
    (c) => typeof c?.name === 'string' && names.has(c.name) && Boolean(c?.value),
  );
}

/**
 * Campos que quebrariam o arquivo (TAB/CR/LF) invalidam o cookie inteiro —
 * cookie válido nunca contém esses caracteres, então descartar é seguro e
 * evita emitir uma linha que o yt-dlp pularia em silêncio.
 * @param {unknown} value
 * @returns {value is string}
 */
function isSafeField(value) {
  return typeof value === 'string' && !/[\t\r\n]/.test(value);
}

/**
 * Serializa cookies do `chrome.cookies.getAll` num documento Netscape
 * completo (cabeçalho + linhas). Cookies inválidos são descartados
 * silenciosamente; sem nenhum cookie válido devolve string vazia — o chamador
 * trata isso como "nenhuma sessão encontrada" e não envia nada ao backend.
 * @param {Array<Record<string, unknown>>} cookies
 * @returns {string}
 */
export function toNetscape(cookies) {
  const lines = [];
  for (const c of cookies ?? []) {
    const rawDomain = typeof c?.domain === 'string' ? c.domain.trim() : '';
    const name = typeof c?.name === 'string' ? c.name : '';
    const value = typeof c?.value === 'string' ? c.value : '';
    if (!rawDomain || !name) continue;
    if (!isSafeField(rawDomain) || !isSafeField(name) || !isSafeField(value)) continue;

    const hostOnly = c?.hostOnly === true;
    const bare = rawDomain.replace(/^\./, '');
    const domain = hostOnly ? bare : `.${bare}`;
    const includeSubdomains = hostOnly ? 'FALSE' : 'TRUE';
    const path = typeof c?.path === 'string' && c.path ? c.path : '/';
    if (!isSafeField(path)) continue;
    const secure = c?.secure === true ? 'TRUE' : 'FALSE';
    const expiresRaw = typeof c?.expirationDate === 'number' ? c.expirationDate : 0;
    const expires =
      Number.isFinite(expiresRaw) && expiresRaw > 0 ? String(Math.floor(expiresRaw)) : '0';

    lines.push([domain, includeSubdomains, path, secure, expires, name, value].join('\t'));
  }

  if (lines.length === 0) return '';
  return `${NETSCAPE_HEADER}\n${lines.join('\n')}\n`;
}
