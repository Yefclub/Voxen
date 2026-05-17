import { useEffect, useState } from 'react';

const KEY = 'voxen:sidebar-collapsed';

export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(KEY) === '1';
  });
  useEffect(() => {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0');
  }, [collapsed]);
  return { collapsed, toggle: () => setCollapsed((v) => !v), setCollapsed };
}
