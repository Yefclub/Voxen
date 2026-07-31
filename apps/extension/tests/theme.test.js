import { afterEach, describe, expect, test } from 'bun:test';

// Importa o MESMO arquivo que roda no browser (script clássico carregado no
// <head> de popup.html/options.html). Ele publica os helpers em globalThis —
// não existe cópia paralela da lógica de tema pra testar.
import '../theme-init.js';

const VoxenTheme = globalThis.VoxenTheme;
const {
  APP_THEMES,
  DEFAULT_DARK_THEME,
  THEME_CACHE_KEY,
  applyTheme,
  cacheTheme,
  fallbackTheme,
  initTheme,
  isAppTheme,
  isDarkTheme,
  normalizeAppTheme,
  readCachedTheme,
  systemPrefersDark,
} = VoxenTheme;

/**
 * Stub mínimo do <html> + matchMedia + localStorage. O bundle real roda no
 * browser; aqui só precisamos do que theme-init.js toca.
 * @param {{ prefersDark?: boolean, cached?: string | null }} [opts]
 */
function stubDom(opts = {}) {
  const root = { dataset: {}, style: {} };
  const store = new Map();
  if (opts.cached != null) store.set(THEME_CACHE_KEY, opts.cached);

  globalThis.document = { documentElement: root };
  globalThis.matchMedia = (query) => ({
    matches: query.includes('dark') ? (opts.prefersDark ?? true) : false,
  });
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  return root;
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.matchMedia;
  delete globalThis.localStorage;
});

describe('theme-init.js', () => {
  test('publica os helpers em globalThis (consumidos por popup.js/options.js)', () => {
    expect(typeof VoxenTheme).toBe('object');
    for (const fn of ['applyTheme', 'cacheTheme', 'fallbackTheme', 'initTheme']) {
      expect(typeof VoxenTheme[fn]).toBe('function');
    }
  });
});

describe('isAppTheme / normalizeAppTheme', () => {
  test('aceita os 4 temas válidos', () => {
    for (const theme of APP_THEMES) {
      expect(isAppTheme(theme)).toBe(true);
      expect(normalizeAppTheme(theme)).toBe(theme);
    }
  });

  test('rejeita valores inválidos e cai no default', () => {
    expect(isAppTheme('dark')).toBe(false);
    expect(isAppTheme(undefined)).toBe(false);
    expect(isAppTheme(null)).toBe(false);
    expect(normalizeAppTheme('nope')).toBe(DEFAULT_DARK_THEME);
    expect(normalizeAppTheme(undefined)).toBe(DEFAULT_DARK_THEME);
  });
});

describe('isDarkTheme', () => {
  test('linear/zinc/emerald são dark, light não é', () => {
    expect(isDarkTheme('linear')).toBe(true);
    expect(isDarkTheme('zinc')).toBe(true);
    expect(isDarkTheme('emerald')).toBe(true);
    expect(isDarkTheme('light')).toBe(false);
  });
});

describe('fallbackTheme', () => {
  test('segue o esquema do SO quando não há instância conectada', () => {
    expect(fallbackTheme(true)).toBe('linear');
    expect(fallbackTheme(false)).toBe('light');
  });
});

describe('systemPrefersDark', () => {
  test('lê prefers-color-scheme quando matchMedia existe', () => {
    stubDom({ prefersDark: false });
    expect(systemPrefersDark()).toBe(false);
    stubDom({ prefersDark: true });
    expect(systemPrefersDark()).toBe(true);
  });

  test('assume dark sem matchMedia', () => {
    expect(systemPrefersDark()).toBe(true);
  });
});

describe('cacheTheme / readCachedTheme', () => {
  test('grava e lê tema válido', () => {
    stubDom();
    cacheTheme('emerald');
    expect(readCachedTheme()).toBe('emerald');
  });

  test('ignora tema inválido na escrita e na leitura', () => {
    stubDom({ cached: 'roxo-neon' });
    expect(readCachedTheme()).toBe(null);
    cacheTheme('roxo-neon');
    expect(readCachedTheme()).toBe(null);
  });

  test('não explode sem localStorage', () => {
    expect(readCachedTheme()).toBe(null);
    expect(() => cacheTheme('linear')).not.toThrow();
  });
});

describe('applyTheme', () => {
  test('escreve data-theme e color-scheme no <html>', () => {
    const root = stubDom();
    applyTheme('light');
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');

    applyTheme('zinc');
    expect(root.dataset.theme).toBe('zinc');
    expect(root.style.colorScheme).toBe('dark');
  });

  test('tema desconhecido cai no default escuro', () => {
    const root = stubDom();
    applyTheme('mid-century-modern');
    expect(root.dataset.theme).toBe(DEFAULT_DARK_THEME);
    expect(root.style.colorScheme).toBe('dark');
  });

  test('não explode sem document', () => {
    expect(() => applyTheme('linear')).not.toThrow();
  });
});

describe('initTheme (pré-paint)', () => {
  test('sem cache e SO em light, aplica o tema claro', () => {
    const root = stubDom({ prefersDark: false });
    expect(initTheme()).toBe('light');
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  test('sem cache e SO em dark, aplica o tema escuro padrão', () => {
    const root = stubDom({ prefersDark: true });
    expect(initTheme()).toBe(DEFAULT_DARK_THEME);
    expect(root.dataset.theme).toBe(DEFAULT_DARK_THEME);
  });

  test('cache da instância conectada vence o esquema do SO', () => {
    const root = stubDom({ prefersDark: true, cached: 'light' });
    expect(initTheme()).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });

  test('cache corrompido não vaza pro <html>', () => {
    const root = stubDom({ prefersDark: false, cached: 'nope' });
    expect(initTheme()).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });
});
