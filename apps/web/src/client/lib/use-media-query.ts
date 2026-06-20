import { useEffect, useState } from 'react';

/**
 * Hook de media query baseado em `window.matchMedia`. SSR-safe: assume `false`
 * antes do mount e sincroniza no efeito (evita mismatch de hidratação e
 * `matchMedia` indefinido fora do browser).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange(); // sync caso a query tenha mudado entre render e mount
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Espelha o breakpoint `md` do Tailwind (768px) — a fronteira mobile/desktop do
// shell. Acima disso o shell desktop monta; abaixo, só a navegação mobile.
const DESKTOP_QUERY = '(min-width: 768px)';

/** `true` quando a viewport é ≥ 768px (desktop/tablet largo, breakpoint `md`). */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
