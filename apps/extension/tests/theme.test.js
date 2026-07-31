import { describe, expect, test } from 'bun:test';
import {
  APP_THEMES,
  DEFAULT_DARK_THEME,
  fallbackTheme,
  isAppTheme,
  isDarkTheme,
  normalizeAppTheme,
} from '../lib/theme.js';

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
