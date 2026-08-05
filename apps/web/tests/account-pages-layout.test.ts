import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const nav = readFileSync(
  resolve(root, 'src/client/components/account/account-page-nav.tsx'),
  'utf8',
);

describe('account pages layout', () => {
  it('keeps all personal sections in one accessible navigation', () => {
    expect(nav).toContain("to: '/conta'");
    expect(nav).toContain("to: '/conta/plataformas'");
    expect(nav).toContain("to: '/conta/mcp'");
    expect(nav).toContain('<NavLink');
    expect(nav).toContain("aria-label={t('account.eyebrow')}");
  });

  for (const page of ['conta.tsx', 'conta-plataformas.tsx', 'conta-mcp.tsx']) {
    it(`${page} uses the common wide account layout`, () => {
      const source = readFileSync(resolve(root, `src/client/pages/${page}`), 'utf8');
      expect(source).toContain('<PageShell width="wide"');
      expect(source).toContain('<AccountPageNav />');
    });
  }
});
