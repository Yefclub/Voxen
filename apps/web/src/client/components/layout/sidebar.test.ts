import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV, isNavItemActive } from './sidebar';
import * as sidebarModule from './sidebar';

describe('single knowledge-workspace interface (spec 219)', () => {
  it('does not export the removed collapsed rail, spacer, or mode switch', () => {
    for (const removed of ['SidebarRail', 'SidebarSpacer', 'SidebarInterfaceModeButton']) {
      expect(removed in sidebarModule).toBe(false);
    }
  });

  it('does not keep the removed interface-mode module', () => {
    for (const file of ['interface-mode.ts', 'interface-mode-provider.tsx']) {
      expect(existsSync(resolve(import.meta.dirname, '..', 'lib', file))).toBe(false);
    }
  });
});

describe('application navigation domains', () => {
  it('keeps one administration entry outside personal and workspace destinations', () => {
    const adminItems = NAV.filter((item) => item.scope === 'admin');
    expect(adminItems).toHaveLength(1);
    expect(adminItems[0]).toMatchObject({ to: '/admin', adminOnly: true });
  });

  it('exposes user-owned account destinations independently', () => {
    expect(NAV.filter((item) => item.scope === 'personal').map((item) => item.to)).toEqual([
      '/conta',
      '/conta/mcp',
      '/conta/ia',
    ]);
  });

  it('keeps the paused artifacts page out of shared navigation', () => {
    expect(NAV.map((item) => item.to)).not.toContain('/artefatos');
  });

  it('does not highlight the account overview together with its child page', () => {
    expect(isNavItemActive('/conta', '/conta')).toBe(true);
    expect(isNavItemActive('/conta/mcp', '/conta')).toBe(false);
    expect(isNavItemActive('/conta/mcp', '/conta/mcp')).toBe(true);
    expect(isNavItemActive('/conta/ia', '/conta')).toBe(false);
    expect(isNavItemActive('/admin/integracoes', '/admin')).toBe(true);
  });
});
