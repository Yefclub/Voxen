import { describe, test, expect } from 'bun:test';
import {
  isOpenSwipe,
  isCloseSwipe,
  DEFAULT_THRESHOLDS,
  type SwipeSample,
} from '../src/client/lib/use-edge-swipe';

const T = DEFAULT_THRESHOLDS;

describe('isOpenSwipe (borda esquerda → direita)', () => {
  test('abre com swipe horizontal a partir da borda', () => {
    const s: SwipeSample = { startX: 10, dx: 120, dy: 10 };
    expect(isOpenSwipe(s)).toBe(true);
  });

  test('não abre se o toque não começou na borda esquerda', () => {
    const s: SwipeSample = { startX: T.edgeZone + 1, dx: 120, dy: 10 };
    expect(isOpenSwipe(s)).toBe(false);
  });

  test('não abre se andou menos que o threshold horizontal', () => {
    const s: SwipeSample = { startX: 5, dx: T.minDistance - 1, dy: 0 };
    expect(isOpenSwipe(s)).toBe(false);
  });

  test('não abre em gesto majoritariamente vertical (scroll)', () => {
    const s: SwipeSample = { startX: 5, dx: 80, dy: 200 };
    expect(isOpenSwipe(s)).toBe(false);
  });

  test('não abre em swipe para a esquerda', () => {
    const s: SwipeSample = { startX: 5, dx: -120, dy: 0 };
    expect(isOpenSwipe(s)).toBe(false);
  });
});

describe('isCloseSwipe (direita → esquerda)', () => {
  test('fecha com swipe horizontal para a esquerda', () => {
    const s: SwipeSample = { startX: 300, dx: -120, dy: 10 };
    expect(isCloseSwipe(s)).toBe(true);
  });

  test('não fecha se andou pouco', () => {
    const s: SwipeSample = { startX: 300, dx: -(T.minDistance - 1), dy: 0 };
    expect(isCloseSwipe(s)).toBe(false);
  });

  test('não fecha em gesto vertical', () => {
    const s: SwipeSample = { startX: 300, dx: -100, dy: 300 };
    expect(isCloseSwipe(s)).toBe(false);
  });

  test('não fecha em swipe para a direita', () => {
    const s: SwipeSample = { startX: 300, dx: 120, dy: 0 };
    expect(isCloseSwipe(s)).toBe(false);
  });
});
