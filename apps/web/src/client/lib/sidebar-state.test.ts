import { describe, test, expect } from 'bun:test';
import { resolveInitialCollapsed } from './sidebar-state';

describe('resolveInitialCollapsed', () => {
  // INTERINO (spec 219 §1): expandida por padrão até o header ganhar o
  // controle de abrir; ver sidebar-state.ts.
  test.each([null, '0', '', 'true', 'false', 'garbage', '2'])(
    'sem recolhimento explícito (%j) → expandida',
    (value) => {
      expect(resolveInitialCollapsed(value)).toBe(false);
    },
  );

  test("'1' explícito → colapsada (usuário recolheu e persistiu)", () => {
    expect(resolveInitialCollapsed('1')).toBe(true);
  });
});
