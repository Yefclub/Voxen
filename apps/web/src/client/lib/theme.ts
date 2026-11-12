/** Two Voxen appearances; legacy persisted packs normalize to the dark identity. */
export const APP_THEMES = ['light', 'dark'] as const;
export type AppTheme = (typeof APP_THEMES)[number];
export const DEFAULT_THEME = 'dark' as const satisfies AppTheme;
export const THEME_STORAGE_KEY = 'voxen:theme';
const THEME_COLORS: Record<AppTheme, string> = { dark: '#141a18', light: '#f8f9f6' };

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'light';
}

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/** The existing public account API and extension retain their wire identifiers. */
export function persistedTheme(theme: AppTheme): 'linear' | 'light' {
  return theme === 'dark' ? 'linear' : 'light';
}

export function isDarkTheme(theme: AppTheme): boolean {
  return theme === 'dark';
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(theme));
}

export function themeColor(theme: AppTheme): string {
  return THEME_COLORS[theme];
}

export function readStoredTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored ? normalizeAppTheme(stored) : null;
  } catch {
    return null;
  }
}

export function persistThemeLocally(theme: AppTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.localStorage.removeItem('voxen:theme-last-dark');
  } catch {
    // Appearance remains usable when browser storage is unavailable.
  }
}

export function toggleLightDark(current: AppTheme): AppTheme {
  return current === 'light' ? 'dark' : 'light';
}
