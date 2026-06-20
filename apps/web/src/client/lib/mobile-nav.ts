/**
 * Taxonomia de rotas pra navegação mobile (sem header). Destinos do bottom-nav
 * são "abas de topo" — não mostram botão de voltar. Todo o resto (detalhes,
 * dashboard, notas, automações, admin, setup, conta) é sub-página → mostra
 * voltar. Pura e determinística pra ser testável sem DOM/router.
 *
 * Mantenha em sincronia com `mobile-bottom-nav.tsx` (lista `ITEMS`).
 */
export const BOTTOM_NAV_TABS = ['/chat', '/jobs', '/transcricoes', '/grafo'] as const;

/**
 * `true` quando o pathname é exatamente uma aba do bottom-nav. Match exato:
 * `/chat/:id`, `/jobs/:id` etc. são sub-páginas, não a aba raiz.
 */
export function isBottomNavTab(pathname: string): boolean {
  return (BOTTOM_NAV_TABS as readonly string[]).includes(pathname);
}

/**
 * `true` quando a rota deve exibir o botão de voltar no mobile — qualquer rota
 * que não seja uma aba de topo do bottom-nav.
 */
export function showsMobileBack(pathname: string): boolean {
  return !isBottomNavTab(pathname);
}

/**
 * `true` quando a rota é full-bleed e já tem controles próprios de navegação
 * (o grafo tem barra flutuante com voltar + busca), então a barra superior
 * mobile do shell não deve ser renderizada pra não duplicar.
 */
export function hasOwnMobileChrome(pathname: string): boolean {
  return pathname === '/grafo' || pathname.startsWith('/grafo/');
}
