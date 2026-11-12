import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('admin layout edge clearance', () => {
  test('aligns administration navigation with the shared page gutters', () => {
    const source = readFileSync(
      new URL('../src/client/components/layout/admin-layout.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('px-5 pt-6 sm:px-8 sm:pt-8 xl:px-10');
  });
});
