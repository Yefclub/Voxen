/**
 * Identificadores de tema — valor persistido por usuário, usado em `data-theme`
 * e espelhado pela extensão (`apps/extension/theme-init.js`).
 *
 * `linear` é o tema padrão e o usuário o vê como **"Voxen"**: o rótulo exibido
 * vive no i18n (`theme.linear`), separado do identificador. Renomear o
 * identificador exigiria migrar o valor já gravado em cada conta e no
 * `localStorage`, além de sincronizar a extensão — custo e risco sem ganho,
 * já que o usuário só enxerga o rótulo. Ao mexer aqui, manter essa separação.
 *
 * A extensão espelha esta lista à mão (`apps/extension/theme-init.js` e
 * `theme.css`). Não há teste amarrando os dois arquivos: `apps/web` lendo
 * fonte de `apps/extension` quebraria a cada reformatação da extensão, que é
 * editada em paralelo. Quem adicionar ou renomear um identificador aqui
 * precisa atualizar a extensão junto.
 */
export const APP_THEMES = ['linear', 'zinc', 'emerald', 'light'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

const THEME_COLORS: Record<AppTheme, string> = {
  linear: '#111113',
  zinc: '#212121',
  emerald: '#19211f',
  light: '#f7f7f8',
};

export const DEFAULT_THEME = 'linear' as const satisfies AppTheme;
export const DARK_THEMES = ['linear', 'zinc', 'emerald'] as const;
export type DarkTheme = (typeof DARK_THEMES)[number];

export const THEME_STORAGE_KEY = 'voxen:theme';
export const LAST_DARK_THEME_KEY = 'voxen:theme-last-dark';

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (APP_THEMES as readonly string[]).includes(value);
}

export function normalizeAppTheme(value: unknown): AppTheme {
  return isAppTheme(value) ? value : DEFAULT_THEME;
}

export function isDarkTheme(theme: AppTheme): theme is DarkTheme {
  return theme === 'linear' || theme === 'zinc' || theme === 'emerald';
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(theme));
}

/** Cor do chrome do browser/PWA para o tema ativo. */
export function themeColor(theme: AppTheme): string {
  return THEME_COLORS[theme];
}

export function readStoredTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeAppTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistThemeLocally(theme: AppTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (isDarkTheme(theme)) {
      window.localStorage.setItem(LAST_DARK_THEME_KEY, theme);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function readLastDarkTheme(): DarkTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(LAST_DARK_THEME_KEY);
    return (DARK_THEMES as readonly string[]).includes(stored ?? '')
      ? (stored as DarkTheme)
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Toggle claro ↔ último tema escuro. */
export function toggleLightDark(current: AppTheme): AppTheme {
  if (current === 'light') return readLastDarkTheme();
  return 'light';
}
