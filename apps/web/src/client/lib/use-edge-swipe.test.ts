import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_THRESHOLDS,
  DRAWER_GESTURE_IGNORE_SELECTOR,
  drawerGestureProgress,
  isCentralOpenSwipe,
  isCloseSwipe,
  isOpenSwipe,
  mobileDrawerWidth,
  matchesDrawerGestureIgnore,
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

  test('acompanha o dedo proporcionalmente sem reagir a scroll vertical', () => {
    expect(mobileDrawerWidth(360)).toBeCloseTo(316.8);
    expect(drawerGestureProgress({ startX: 180, dx: 158.4, dy: 10 }, 360, false)).toBeCloseTo(0.5);
    expect(drawerGestureProgress({ startX: 180, dx: -158.4, dy: 10 }, 360, true)).toBeCloseTo(0.5);
    expect(drawerGestureProgress({ startX: 180, dx: 80, dy: 60 }, 360, false)).toBe(0);
  });

  test('ignora controles nativos, editores e controles ARIA', () => {
    for (const selector of [
      'input',
      '[contenteditable]',
      '[tabindex]:not([tabindex="-1"])',
      '[aria-haspopup]',
      '[role="checkbox"]',
      '[role="link"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="option"]',
      '[role="treeitem"]',
      '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]',
      '[role="slider"]',
      '[role="textbox"]',
    ]) {
      expect(DRAWER_GESTURE_IGNORE_SELECTOR).toContain(selector);
    }
    expect(
      matchesDrawerGestureIgnore({
        closest: (selector) => (selector.includes('[contenteditable]') ? {} : null),
      }),
    ).toBe(true);
    expect(matchesDrawerGestureIgnore({ closest: () => null })).toBe(false);
    expect(matchesDrawerGestureIgnore(null)).toBe(false);
  });
});
