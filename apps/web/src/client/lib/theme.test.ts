import { describe, expect, test } from 'bun:test';
import { isAppTheme, normalizeAppTheme, themeColor, toggleLightDark, type AppTheme } from './theme';

describe('theme helpers', () => {
  test('normalizes unknown values to the principal Linear theme', () => {
    expect(normalizeAppTheme(undefined)).toBe('linear');
    expect(normalizeAppTheme('nope')).toBe('linear');
    expect(normalizeAppTheme('linear')).toBe('linear');
    expect(normalizeAppTheme('emerald')).toBe('emerald');
  });

  test('isAppTheme accepts only known ids', () => {
    for (const id of ['linear', 'zinc', 'emerald', 'light'] as AppTheme[]) {
      expect(isAppTheme(id)).toBe(true);
    }
    expect(isAppTheme('dark')).toBe(false);
  });

  test('toggleLightDark switches to light from dark themes', () => {
    expect(toggleLightDark('linear')).toBe('light');
    expect(toggleLightDark('zinc')).toBe('light');
    expect(toggleLightDark('emerald')).toBe('light');
  });

  test('maps each theme to its browser chrome color', () => {
    expect(themeColor('linear')).toBe('#111113');
    expect(themeColor('zinc')).toBe('#212121');
    expect(themeColor('emerald')).toBe('#19211f');
    expect(themeColor('light')).toBe('#f7f7f8');
  });
});
