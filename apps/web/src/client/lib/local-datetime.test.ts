import { describe, expect, it } from 'bun:test';
import { nextLocalDateTimeInputMin } from './local-datetime';

describe('nextLocalDateTimeInputMin', () => {
  const instant = new Date('2026-08-03T13:30:45.000Z');

  it('uses local wall time in a negative UTC timezone', () => {
    expect(nextLocalDateTimeInputMin(instant, 180)).toBe('2026-08-03T10:31');
  });

  it('uses local wall time in a positive UTC timezone', () => {
    expect(nextLocalDateTimeInputMin(instant, -540)).toBe('2026-08-03T22:31');
  });

  it('advances to the next minute even on an exact minute boundary', () => {
    expect(nextLocalDateTimeInputMin(new Date('2026-08-03T13:30:00.000Z'), 0)).toBe(
      '2026-08-03T13:31',
    );
  });
});
