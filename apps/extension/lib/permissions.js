/**
 * Permissão de host (chrome.permissions) — compartilhado entre popup e
 * options para evitar duas implementações divergentes do mesmo check.
 */

import { originPattern } from './config.js';

/**
 * Só checa (nunca pede) — usado antes de chamadas "silenciosas" em segundo
 * plano (ex.: buscar o tema) onde um prompt de permissão seria intrusivo.
 * @param {string} baseUrl
 * @returns {Promise<boolean>}
 */
export async function hasHostPermission(baseUrl) {
  const pattern = originPattern(baseUrl);
  if (!pattern) return false;
  if (!chrome.permissions) return true;
  return chrome.permissions.contains({ origins: [pattern] });
}

/**
 * Garante (ou pede) a host permission da baseUrl. Sem ela o fetch com
 * `credentials: 'include'` não envia cookies de sessão (CORS bloqueia).
 * Só chamar em resposta a uma ação explícita do usuário (o Chromium exige
 * gesto do usuário para `chrome.permissions.request`).
 * @param {string} baseUrl
 * @returns {Promise<boolean>}
 */
export async function ensureHostPermission(baseUrl) {
  const pattern = originPattern(baseUrl);
  if (!pattern) return false;
  if (!chrome.permissions) return true;
  const already = await chrome.permissions.contains({ origins: [pattern] });
  if (already) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

/**
 * Acesso necessário pra capturar cookies de UMA plataforma: a permissão
 * `cookies` (opcional no manifest) + a host permission daquele domínio.
 * Ambas on-demand — o padrão é a extensão NÃO poder ler cookie nenhum.
 * @param {{ origins: string[] }} platform
 * @returns {Promise<boolean>}
 */
export async function hasPlatformCookieAccess(platform) {
  if (!chrome.permissions) return true;
  return chrome.permissions.contains({
    permissions: ['cookies'],
    origins: platform.origins,
  });
}

/**
 * Igual à anterior, mas PEDE o que faltar. Só chamar dentro do handler de um
 * clique: o Chromium exige gesto do usuário para `permissions.request`.
 * @param {{ origins: string[] }} platform
 * @returns {Promise<boolean>}
 */
export async function ensurePlatformCookieAccess(platform) {
  if (!chrome.permissions) return true;
  const request = { permissions: ['cookies'], origins: platform.origins };
  if (await chrome.permissions.contains(request)) return true;
  return chrome.permissions.request(request);
}

/**
 * Revoga o acesso de cookies daquela plataforma (só as origens; a permissão
 * `cookies` continua se outra plataforma ainda estiver conectada).
 * @param {{ origins: string[] }} platform
 */
export async function revokePlatformCookieAccess(platform) {
  if (!chrome.permissions) return;
  try {
    await chrome.permissions.remove({ origins: platform.origins });
  } catch {
    /* revogar é best-effort — nunca deve quebrar o fluxo da UI */
  }
}
