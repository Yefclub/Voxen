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
