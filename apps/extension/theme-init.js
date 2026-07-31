/**
 * Tema da extensão — fonte única da verdade.
 *
 * Este arquivo é carregado como **script clássico** (`<script src>` sem
 * `type="module"`) no `<head>` de popup.html e options.html, antes do CSS.
 * Dois motivos, nesta ordem:
 *
 * 1. A CSP padrão do MV3 (`script-src 'self'`) bloqueia script inline em
 *    páginas de extensão, e `'unsafe-inline'` não é permitido no manifesto —
 *    logo, o tema pré-paint precisa vir de um arquivo próprio.
 * 2. Script clássico é executado na hora; `type="module"` é adiado (defer
 *    implícito) e pintaria um frame com o tema errado.
 *
 * Como script clássico não pode usar `import`/`export`, os helpers são
 * publicados em `globalThis.VoxenTheme` — popup.js e options.js (que são
 * módulos) consomem daí, e os testes importam este mesmo arquivo. Assim não
 * existe cópia paralela da lógica de tema: o que os testes exercitam é
 * exatamente o que roda no browser.
 *
 * Espelha apps/web/src/client/lib/theme.ts (a extensão é um pacote standalone
 * gerado por package.sh e não importa o app web).
 */

(function (global) {
  'use strict';

  /** @type {readonly ['linear', 'zinc', 'emerald', 'light']} */
  var APP_THEMES = ['linear', 'zinc', 'emerald', 'light'];

  /** Tema escuro usado como fallback quando o SO prefere dark e não há sessão. */
  var DEFAULT_DARK_THEME = 'linear';

  /** Chave do cache de tema (localStorage da origem chrome-extension://). */
  var THEME_CACHE_KEY = 'voxen-ext-theme';

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function isAppTheme(value) {
    return typeof value === 'string' && APP_THEMES.indexOf(value) !== -1;
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeAppTheme(value) {
    return isAppTheme(value) ? /** @type {string} */ (value) : DEFAULT_DARK_THEME;
  }

  /**
   * @param {string} theme
   * @returns {boolean}
   */
  function isDarkTheme(theme) {
    return theme === 'linear' || theme === 'zinc' || theme === 'emerald';
  }

  /**
   * Tema de fallback quando a extensão ainda não está conectada a nenhuma
   * instância (sem tema conhecido) — segue o esquema claro/escuro do SO.
   * @param {boolean} prefersDark
   * @returns {string}
   */
  function fallbackTheme(prefersDark) {
    return prefersDark ? DEFAULT_DARK_THEME : 'light';
  }

  /**
   * Sem `matchMedia` (ambiente sem DOM) assume dark — é o tema histórico da
   * extensão e o menos agressivo se a detecção falhar.
   * @returns {boolean}
   */
  function systemPrefersDark() {
    if (typeof global.matchMedia !== 'function') return true;
    return global.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Último tema resolvido a partir da instância conectada, se houver.
   * @returns {string | null}
   */
  function readCachedTheme() {
    try {
      var cached = global.localStorage.getItem(THEME_CACHE_KEY);
      return isAppTheme(cached) ? cached : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * @param {unknown} theme
   * @returns {void}
   */
  function cacheTheme(theme) {
    if (!isAppTheme(theme)) return;
    try {
      global.localStorage.setItem(THEME_CACHE_KEY, theme);
    } catch (err) {
      /* localStorage indisponível — cache é otimização, não requisito */
    }
  }

  /**
   * Aplica o tema no <html> (data-theme + color-scheme inline, para o
   * navegador não "piscar" scrollbars/form controls no esquema errado).
   * @param {unknown} theme
   * @returns {void}
   */
  function applyTheme(theme) {
    if (typeof global.document === 'undefined' || !global.document.documentElement) return;
    var normalized = normalizeAppTheme(theme);
    var root = global.document.documentElement;
    root.dataset.theme = normalized;
    root.style.colorScheme = isDarkTheme(normalized) ? 'dark' : 'light';
  }

  /**
   * Tema pré-paint: cache da instância conectada, senão o esquema do SO.
   * popup.js/options.js refinam depois com o tema real vindo de /api/me.
   * @returns {string}
   */
  function initTheme() {
    var theme = readCachedTheme() || fallbackTheme(systemPrefersDark());
    applyTheme(theme);
    return theme;
  }

  global.VoxenTheme = {
    APP_THEMES: APP_THEMES,
    DEFAULT_DARK_THEME: DEFAULT_DARK_THEME,
    THEME_CACHE_KEY: THEME_CACHE_KEY,
    isAppTheme: isAppTheme,
    normalizeAppTheme: normalizeAppTheme,
    isDarkTheme: isDarkTheme,
    fallbackTheme: fallbackTheme,
    systemPrefersDark: systemPrefersDark,
    readCachedTheme: readCachedTheme,
    cacheTheme: cacheTheme,
    applyTheme: applyTheme,
    initTheme: initTheme,
  };

  // Só auto-aplica quando há DOM (no browser). Importado pelos testes, o
  // arquivo apenas publica os helpers.
  if (typeof global.document !== 'undefined') initTheme();
})(typeof globalThis !== 'undefined' ? globalThis : self);
