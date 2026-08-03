import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  APP_THEMES,
  DARK_THEMES,
  DEFAULT_THEME,
  isAppTheme,
  isDarkTheme,
  normalizeAppTheme,
  themeColor,
  toggleLightDark,
  type AppTheme,
} from './theme';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('theme helpers', () => {
  test('normalizes unknown values to the default theme', () => {
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

/**
 * O tema padrão é exibido como "Voxen" mas continua gravado como `linear`.
 * Estes testes travam essa separação: quem já tinha o padrão salvo não pode
 * cair em outro tema, e a extensão espelha o mesmo identificador.
 */
describe('rótulo Voxen sobre o identificador persistido', () => {
  test('mantém `linear` como identificador padrão e opção válida', () => {
    expect(DEFAULT_THEME).toBe('linear');
    expect(APP_THEMES).toContain('linear');
    expect(DARK_THEMES).toContain('linear');
    expect(isDarkTheme('linear')).toBe(true);
  });

  test('preserva o tema de quem já tinha o padrão gravado', () => {
    // Valor vindo do banco / localStorage de uma conta anterior à renomeação.
    const persisted: unknown = 'linear';

    expect(isAppTheme(persisted)).toBe(true);
    expect(normalizeAppTheme(persisted)).toBe(DEFAULT_THEME);
    expect(themeColor(normalizeAppTheme(persisted))).toBe('#111113');
  });

  test('não introduz um identificador `voxen` que invalidaria o dado salvo', () => {
    expect(isAppTheme('voxen')).toBe(false);
    expect(normalizeAppTheme('voxen')).toBe('linear');
    expect(APP_THEMES).not.toContain('voxen' as AppTheme);
  });

  test('exibe "Voxen" nos dois idiomas, sem tocar no identificador', () => {
    const i18n = read('./i18n.tsx');
    const labels = [...i18n.matchAll(/'theme\.linear': '([^']+)'/g)].map(([, label]) => label);

    expect(labels).toEqual(['Voxen', 'Voxen']);
    expect(i18n).not.toContain("'theme.linear': 'Linear'");
  });
});
