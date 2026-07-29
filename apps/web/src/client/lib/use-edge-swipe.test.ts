import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_THRESHOLDS,
  isCentralOpenSwipe,
  isCloseSwipe,
  isOpenSwipe,
} from './use-edge-swipe';

describe('gestos do drawer mobile', () => {
  test('abre pela borda ou pela região central em arrasto horizontal para direita', () => {
    expect(isOpenSwipe({ startX: 20, dx: 72, dy: 12 })).toBe(true);
    expect(isCentralOpenSwipe({ startX: 180, dx: 72, dy: 12 }, 360)).toBe(true);
  });

  test('não abre por toque fora da região permitida, gesto curto ou scroll vertical', () => {
    expect(isCentralOpenSwipe({ startX: 50, dx: 90, dy: 0 }, 360)).toBe(false);
    expect(isCentralOpenSwipe({ startX: 180, dx: 40, dy: 0 }, 360)).toBe(false);
    expect(isCentralOpenSwipe({ startX: 180, dx: 80, dy: 60 }, 360)).toBe(false);
    expect(isCentralOpenSwipe({ startX: 180, dx: 80, dy: 0 }, 0)).toBe(false);
  });

  test('mantém o fechamento por arrasto horizontal para esquerda', () => {
    expect(isCloseSwipe({ startX: 260, dx: -DEFAULT_THRESHOLDS.minDistance, dy: 10 })).toBe(true);
  });
});
