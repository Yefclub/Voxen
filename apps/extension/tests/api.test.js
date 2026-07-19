import { describe, expect, test } from 'bun:test';
import { compareSemver } from '../lib/api.js';

describe('compareSemver', () => {
  test('ordena versões', () => {
    expect(compareSemver('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
  });
});
