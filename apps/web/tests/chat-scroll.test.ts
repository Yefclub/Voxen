import { describe, expect, test } from 'bun:test';
import {
  ANCHOR_MAX_MESSAGE_RATIO,
  ANCHOR_TOP_GAP_PX,
  FOLLOW_REARM_DISTANCE_PX,
  REENGAGE_GAP_MIN_PX,
  SPACER_EPSILON_PX,
  canRearmFollow,
  isUserScrollUp,
  nextSpacerHeight,
  planAnchor,
  reengageThresholdPx,
  shouldAnchor,
  shouldReengageFollow,
  visibleBandHeight,
} from '../src/client/lib/chat-scroll';

describe('visibleBandHeight', () => {
  test('subtracts composer from viewport', () => {
    expect(visibleBandHeight(800, 120)).toBe(680);
  });

  test('clamps to zero when composer covers everything', () => {
    expect(visibleBandHeight(100, 300)).toBe(0);
  });
});

describe('shouldAnchor', () => {
  test('anchors a normal message under the max band ratio', () => {
    expect(
      shouldAnchor({
        messageHeight: 200,
        clientHeight: 800,
        composerHeight: 120,
      }),
    ).toBe(true);
  });

  test('skips anchor when message is taller than max band ratio', () => {
    const band = 800 - 120;
    expect(
      shouldAnchor({
        messageHeight: band * ANCHOR_MAX_MESSAGE_RATIO + 1,
        clientHeight: 800,
        composerHeight: 120,
      }),
    ).toBe(false);
  });

  test('skips anchor when there is no visible band', () => {
    expect(
      shouldAnchor({
        messageHeight: 10,
        clientHeight: 100,
        composerHeight: 200,
      }),
    ).toBe(false);
  });
});

describe('planAnchor', () => {
  test('targets scroll with a top gap above the message', () => {
    const plan = planAnchor({
      messageTop: 5000,
      clientHeight: 800,
      scrollHeight: 5400,
      currentSpacerHeight: 0,
    });
    expect(plan.targetScrollTop).toBe(5000 - ANCHOR_TOP_GAP_PX);
    expect(plan.reserveEnd).toBe(plan.targetScrollTop + 800);
  });

  test('computes spacer so the anchor sits at max scroll', () => {
    const plan = planAnchor({
      messageTop: 5000,
      clientHeight: 800,
      scrollHeight: 5400,
      currentSpacerHeight: 0,
    });
    expect(plan.spacerHeight).toBe(plan.reserveEnd - 5400);
    expect(plan.reserveEnd - 800).toBe(plan.targetScrollTop);
  });

  test('subtracts residual spacer from the natural end', () => {
    const without = planAnchor({
      messageTop: 5000,
      clientHeight: 800,
      scrollHeight: 5400,
      currentSpacerHeight: 0,
    });
    const withResidual = planAnchor({
      messageTop: 5000,
      clientHeight: 800,
      scrollHeight: 5700,
      currentSpacerHeight: 300,
    });
    expect(withResidual.spacerHeight).toBe(without.spacerHeight);
  });

  test('zeros spacer when content below already fills the viewport', () => {
    const plan = planAnchor({
      messageTop: 1000,
      clientHeight: 800,
      scrollHeight: 3000,
      currentSpacerHeight: 0,
    });
    expect(plan.spacerHeight).toBe(0);
  });

  test('clamps target to zero for the first conversation message', () => {
    const plan = planAnchor({
      messageTop: 8,
      clientHeight: 800,
      scrollHeight: 900,
      currentSpacerHeight: 0,
    });
    expect(plan.targetScrollTop).toBe(0);
  });
});

describe('nextSpacerHeight', () => {
  const reserveEnd = 5788;

  test('shrinks as content grows (constant reserve)', () => {
    expect(
      nextSpacerHeight({
        reserveEnd,
        scrollHeight: 5788,
        currentSpacerHeight: 388,
      }),
    ).toBe(388);
    expect(
      nextSpacerHeight({
        reserveEnd,
        scrollHeight: 5888,
        currentSpacerHeight: 388,
      }),
    ).toBe(288);
  });

  test('clamps to zero when content exceeds the reserve', () => {
    expect(
      nextSpacerHeight({
        reserveEnd,
        scrollHeight: 7000,
        currentSpacerHeight: 100,
      }),
    ).toBe(0);
  });

  test('re-inflates if content shrinks (reflow)', () => {
    expect(
      nextSpacerHeight({
        reserveEnd,
        scrollHeight: 5300,
        currentSpacerHeight: 100,
      }),
    ).toBe(588);
  });
});

describe('reengageThresholdPx', () => {
  test('uses ~3% of viewport when above the floor', () => {
    expect(reengageThresholdPx(1000)).toBe(30);
  });

  test('applies the floor on short viewports', () => {
    expect(reengageThresholdPx(400)).toBe(REENGAGE_GAP_MIN_PX);
  });
});

describe('shouldReengageFollow', () => {
  const base = {
    containerBottomViewport: 900,
    composerHeight: 120,
    clientHeight: 800,
  };

  test('stays off while content is far from the composer', () => {
    expect(shouldReengageFollow({ ...base, contentBottomViewport: 500 })).toBe(false);
  });

  test('reengages when the gap is within the threshold', () => {
    expect(shouldReengageFollow({ ...base, contentBottomViewport: 760 })).toBe(true);
  });

  test('works with composerHeight 0 (Voxen layout: composer outside scroller)', () => {
    expect(
      shouldReengageFollow({
        containerBottomViewport: 900,
        composerHeight: 0,
        clientHeight: 800,
        contentBottomViewport: 880,
      }),
    ).toBe(true);
    expect(
      shouldReengageFollow({
        containerBottomViewport: 900,
        composerHeight: 0,
        clientHeight: 800,
        contentBottomViewport: 850,
      }),
    ).toBe(false);
  });
});

describe('isUserScrollUp', () => {
  test('detects upward scroll beyond tolerance', () => {
    expect(isUserScrollUp(500, 490)).toBe(true);
  });

  test('ignores jitter inside tolerance', () => {
    expect(isUserScrollUp(500, 497)).toBe(false);
  });
});

describe('canRearmFollow', () => {
  test('rearms near the real bottom without spacer', () => {
    expect(canRearmFollow({ distanceToBottom: 100, spacerHeight: 0 })).toBe(true);
  });

  test('does not rearm while spacer is artificially filling the bottom', () => {
    expect(
      canRearmFollow({
        distanceToBottom: 0,
        spacerHeight: SPACER_EPSILON_PX + 1,
      }),
    ).toBe(false);
  });

  test('allows epsilon residual spacer', () => {
    expect(
      canRearmFollow({
        distanceToBottom: 0,
        spacerHeight: SPACER_EPSILON_PX,
      }),
    ).toBe(true);
  });

  test('does not rearm far from the bottom', () => {
    expect(
      canRearmFollow({
        distanceToBottom: FOLLOW_REARM_DISTANCE_PX + 1,
        spacerHeight: 0,
      }),
    ).toBe(false);
  });
});
