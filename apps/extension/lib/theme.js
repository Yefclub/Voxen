/**
 * Helpers puros de tema — espelham apps/web/src/client/lib/theme.ts.
 * A extensão não importa o app web (pacote standalone via package.sh), então
 * a lista de temas válidos é replicada aqui.
 */

/** @type {readonly ['linear', 'zinc', 'emerald', 'light']} */
export const APP_THEMES = ['linear', 'zinc', 'emerald', 'light'];

/** Tema escuro usado como fallback quando o SO prefere dark e não há sessão. */
export const DEFAULT_DARK_THEME = 'linear';

/**
 * @param {unknown} value
 * @returns {value is 'linear' | 'zinc' | 'emerald' | 'light'}
 */
export function isAppTheme(value) {
  return typeof value === 'string' && APP_THEMES.includes(value);
}

/**
 * @param {unknown} value
 */
export function normalizeAppTheme(value) {
  return isAppTheme(value) ? value : DEFAULT_DARK_THEME;
}

/**
 * @param {string} theme
 */
export function isDarkTheme(theme) {
  return theme === 'linear' || theme === 'zinc' || theme === 'emerald';
}

/**
 * Tema de fallback quando a extensão ainda não está conectada a nenhuma
 * instância (sem tema conhecido) — segue o esquema claro/escuro do SO.
 * @param {boolean} prefersDark
 */
export function fallbackTheme(prefersDark) {
  return prefersDark ? DEFAULT_DARK_THEME : 'light';
}

/**
 * @returns {boolean}
 */
export function systemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Aplica o tema no <html> (data-theme + color-scheme inline, para o
 * navegador não "piscar" scrollbars/form controls no esquema errado).
 * @param {string} theme
 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeAppTheme(theme);
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized === 'light' ? 'light' : 'dark';
}
