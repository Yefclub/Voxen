import { describe, expect, it } from 'bun:test';
import { NAV, isNavItemActive } from './sidebar';

describe('application navigation domains', () => {
  it('keeps one administration entry outside personal and workspace destinations', () => {
    const adminItems = NAV.filter((item) => item.scope === 'admin');
    expect(adminItems).toHaveLength(1);
    expect(adminItems[0]).toMatchObject({ to: '/admin', adminOnly: true });
  });

  it('exposes user-owned account destinations independently', () => {
    expect(NAV.filter((item) => item.scope === 'personal').map((item) => item.to)).toEqual([
      '/conta',
      '/conta/plataformas',
      '/conta/mcp',
    ]);
  });

  it('keeps the paused artifacts page out of shared navigation', () => {
    expect(NAV.map((item) => item.to)).not.toContain('/artefatos');
  });

  it('does not highlight the account overview together with its child page', () => {
    expect(isNavItemActive('/conta', '/conta')).toBe(true);
    expect(isNavItemActive('/conta/mcp', '/conta')).toBe(false);
    expect(isNavItemActive('/conta/mcp', '/conta/mcp')).toBe(true);
    expect(isNavItemActive('/admin/integracoes', '/admin')).toBe(true);
  });
});
