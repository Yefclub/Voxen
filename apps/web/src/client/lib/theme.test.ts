import { describe, expect, test } from 'bun:test';
import { isAppTheme, normalizeAppTheme, themeColor, toggleLightDark, type AppTheme } from './theme';

describe('theme helpers', () => {
  test('normalizes unknown values to zinc', () => {
    expect(normalizeAppTheme(undefined)).toBe('zinc');
    expect(normalizeAppTheme('nope')).toBe('zinc');
    expect(normalizeAppTheme('emerald')).toBe('emerald');
  });

  test('isAppTheme accepts only known ids', () => {
    for (const id of ['zinc', 'emerald', 'light'] as AppTheme[]) {
      expect(isAppTheme(id)).toBe(true);
    }
    expect(isAppTheme('dark')).toBe(false);
  });

  test('toggleLightDark switches to light from dark themes', () => {
    expect(toggleLightDark('zinc')).toBe('light');
    expect(toggleLightDark('emerald')).toBe('light');
  });

  test('maps each theme to its browser chrome color', () => {
    expect(themeColor('zinc')).toBe('#212121');
    expect(themeColor('emerald')).toBe('#19211f');
    expect(themeColor('light')).toBe('#f7f7f8');
  });
});
