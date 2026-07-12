export const APP_THEMES = ['zinc', 'emerald', 'light'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export const DEFAULT_THEME: AppTheme = 'zinc';
export const DARK_THEMES = ['zinc', 'emerald'] as const;
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
  return theme === 'zinc' || theme === 'emerald';
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
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
  if (typeof window === 'undefined') return 'zinc';
  try {
    const stored = window.localStorage.getItem(LAST_DARK_THEME_KEY);
    return stored === 'emerald' ? 'emerald' : 'zinc';
  } catch {
    return 'zinc';
  }
}

/** Toggle claro ↔ último tema escuro. */
export function toggleLightDark(current: AppTheme): AppTheme {
  if (current === 'light') return readLastDarkTheme();
  return 'light';
}
