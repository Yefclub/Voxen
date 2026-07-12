import { useEffect, useState } from 'react';

const KEY = 'voxen:sidebar-collapsed';

/**
 * Resolve o estado inicial de colapso a partir do valor bruto salvo no
 * localStorage (ou `null` quando não há preferência). Pura e testável sem
 * DOM: o rail colapsado é o padrão em todas as páginas desktop — só `'0'`
 * explícito (usuário expandiu e essa escolha foi persistida) reabre a sidebar
 * cheia por padrão. `'1'` ou qualquer valor inesperado mantém collapsed=true.
 */
export function resolveInitialCollapsed(stored: string | null): boolean {
  if (stored === '0') return false;
  return true;
}

// Store singleton — múltiplas instâncias de useSidebarCollapsed compartilham
// o mesmo state. Sem isso, Sidebar e SidebarSpacer ficariam dessincronizados.
const subscribers = new Set<(v: boolean) => void>();
let current: boolean =
  typeof window === 'undefined' ? false : resolveInitialCollapsed(window.localStorage.getItem(KEY));

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
