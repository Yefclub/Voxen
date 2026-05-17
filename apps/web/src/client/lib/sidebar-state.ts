import { useEffect, useState } from 'react';

const KEY = 'voxen:sidebar-collapsed';

// Store singleton — múltiplas instâncias de useSidebarCollapsed compartilham
// o mesmo state. Sem isso, Sidebar e SidebarSpacer ficariam dessincronizados.
const subscribers = new Set<(v: boolean) => void>();
let current: boolean =
  typeof window === 'undefined' ? false : window.localStorage.getItem(KEY) === '1';

function setCollapsedGlobal(next: boolean): void {
  current = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KEY, next ? '1' : '0');
  }
  subscribers.forEach((cb) => cb(next));
}

export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
} {
  const [collapsed, setLocal] = useState<boolean>(current);
  useEffect(() => {
    subscribers.add(setLocal);
    setLocal(current); // garante sync se o store mudou entre render e mount
    return () => {
      subscribers.delete(setLocal);
    };
  }, []);
  return {
    collapsed,
    toggle: () => setCollapsedGlobal(!current),
    setCollapsed: setCollapsedGlobal,
  };
}
