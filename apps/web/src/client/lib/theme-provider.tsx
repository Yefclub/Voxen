import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiPatch } from './api';
import { useMe } from './hooks';
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  normalizeAppTheme,
  persistThemeLocally,
  readStoredTheme,
  toggleLightDark,
  type AppTheme,
} from './theme';

type ThemeContextValue = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => Promise<void>;
  toggleAppearance: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { data, refresh } = useMe();
  const [theme, setThemeState] = useState<AppTheme>(() => readStoredTheme() ?? DEFAULT_THEME);

  useEffect(() => {
    applyThemeToDocument(theme);
    persistThemeLocally(theme);
  }, [theme]);

  useEffect(() => {
    if (!data?.user?.theme) return;
    setThemeState(normalizeAppTheme(data.user.theme));
  }, [data?.user?.theme]);

  const setTheme = useCallback(
    async (next: AppTheme) => {
      const normalized = normalizeAppTheme(next);
      setThemeState(normalized);
      applyThemeToDocument(normalized);
      persistThemeLocally(normalized);
      try {
        await apiPatch('/api/account', { theme: normalized });
        await refresh();
      } catch {
        /* keep local theme; next /api/me refresh will reconcile */
      }
    },
    [refresh],
  );

  const toggleAppearance = useCallback(async () => {
    await setTheme(toggleLightDark(theme));
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleAppearance }),
    [theme, setTheme, toggleAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
