import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('admin layout edge clearance', () => {
  test('keeps the administration banner aligned with the desktop page clearance', () => {
    const source = readFileSync(
      new URL('../src/client/components/layout/admin-layout.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('px-4 sm:px-7 md:pt-5 xl:px-10');
  });
});
