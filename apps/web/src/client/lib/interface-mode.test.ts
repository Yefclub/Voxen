import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_INTERFACE_MODE,
  normalizeInterfaceMode,
  toggleInterfaceMode,
} from './interface-mode';

describe('interface mode helpers', () => {
  it('keeps the current shell as the safe default', () => {
    expect(DEFAULT_INTERFACE_MODE).toBe('classic');
    expect(normalizeInterfaceMode(undefined)).toBe('classic');
    expect(normalizeInterfaceMode('unknown')).toBe('classic');
  });

  it('accepts focus and toggles both supported modes', () => {
    expect(normalizeInterfaceMode('focus')).toBe('focus');
    expect(toggleInterfaceMode('classic')).toBe('focus');
    expect(toggleInterfaceMode('focus')).toBe('classic');
  });

  it('keeps focus geometry desktop-only and exposes the sidebar toggle state', () => {
    const layout = readFileSync(
      join(import.meta.dir, '../components/layout/app-layout.tsx'),
      'utf8',
    );
    const sidebar = readFileSync(join(import.meta.dir, '../components/layout/sidebar.tsx'), 'utf8');
    expect(layout).toContain('data-interface-mode={interfaceMode}');
    expect(layout).toContain('md:m-2 md:overflow-hidden md:rounded-2xl');
    expect(sidebar).toContain("interfaceMode === 'focus'");
    expect(sidebar).toContain('aria-pressed={focusInterface}');
  });
});
