import { describe, expect, test } from 'bun:test';
import {
  formatGuidePercent,
  formatGuideSignedPercent,
} from '../src/client/lib/personal-guide-format';

describe('personal Guide score formatting', () => {
  test('keeps negative evidence visible while bounding invalid display values', () => {
    expect(formatGuideSignedPercent(-0.42)).toBe('-42%');
    expect(formatGuideSignedPercent(0.42)).toBe('+42%');
    expect(formatGuideSignedPercent(1.42)).toBe('+142%');
    expect(formatGuideSignedPercent(Number.NaN)).toBe('0%');
    expect(formatGuidePercent(-0.42)).toBe('0%');
    expect(formatGuidePercent(2)).toBe('100%');
  });
});
