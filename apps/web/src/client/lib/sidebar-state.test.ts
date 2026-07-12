import { describe, test, expect } from 'bun:test';
import { resolveInitialCollapsed } from './sidebar-state';

describe('resolveInitialCollapsed', () => {
  test('sem preferência salva (null) → colapsada (rail é o padrão)', () => {
    expect(resolveInitialCollapsed(null)).toBe(true);
  });

  test("'0' explícito → expandida (usuário abriu e persistiu)", () => {
    expect(resolveInitialCollapsed('0')).toBe(false);
  });

  test("'1' explícito → colapsada", () => {
    expect(resolveInitialCollapsed('1')).toBe(true);
  });

  test.each(['', 'true', 'false', 'garbage', '2'])(
    'valor inesperado (%j) → colapsada (fallback pro padrão)',
    (value) => {
      expect(resolveInitialCollapsed(value)).toBe(true);
    },
  );
});
