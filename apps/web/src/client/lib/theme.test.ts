import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'bun:test';
import {
  APP_THEMES,
  DEFAULT_THEME,
  isAppTheme,
  normalizeAppTheme,
  persistedTheme,
  themeColor,
  toggleLightDark,
} from './theme';

describe('Voxen appearance migration', () => {
  test('offers only light and dark appearances', () => {
    expect(APP_THEMES).toEqual(['light', 'dark']);
    expect(isAppTheme('light')).toBe(true);
    expect(isAppTheme('dark')).toBe(true);
    expect(isAppTheme('emerald')).toBe(false);
    expect(isAppTheme('unknown')).toBe(false);
  });
  test('retains every previous dark preference and the previous light preference', () => {
    for (const stored of ['linear', 'zinc', 'emerald', 'dark', null, undefined, 'unknown']) {
      expect(normalizeAppTheme(stored)).toBe(DEFAULT_THEME);
    }
    expect(normalizeAppTheme('light')).toBe('light');
  });
  test('preserves the public account API and extension identifiers', () => {
    expect(persistedTheme('dark')).toBe('linear');
    expect(persistedTheme('light')).toBe('light');
    for (const theme of APP_THEMES) expect(normalizeAppTheme(persistedTheme(theme))).toBe(theme);
  });
  test('toggles the complete identity and browser chrome together', () => {
    expect(toggleLightDark('light')).toBe('dark');
    expect(toggleLightDark('dark')).toBe('light');
    expect(themeColor('dark')).toBe('#141a18');
    expect(themeColor('light')).toBe('#f8f9f6');
  });
});

describe('pre-paint appearance bootstrap', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  function boot(stored: string | null, light: boolean): { theme?: string; chrome?: string } {
    const result: { theme?: string; chrome?: string } = {};
    const dataset = {
      set theme(value: string) {
        result.theme = value;
      },
    };
    runInNewContext(script, {
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: light }),
      document: {
        documentElement: { dataset, style: {} },
        querySelector: () => ({
          setAttribute: (_: string, value: string) => {
            result.chrome = value;
          },
        }),
      },
    });
    return result;
  }
  test('normalizes all saved appearances before React or CSS loads', () => {
    for (const legacy of ['linear', 'zinc', 'emerald', 'dark'])
      expect(boot(legacy, true)).toEqual({ theme: 'dark', chrome: themeColor('dark') });
    expect(boot('light', false)).toEqual({ theme: 'light', chrome: themeColor('light') });
  });
  test('follows the system only when no preference was saved', () => {
    expect(boot(null, true).theme).toBe('light');
    expect(boot(null, false).theme).toBe('dark');
  });
});
