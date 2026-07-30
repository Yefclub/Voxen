/**
 * Taxonomia de rotas pra navegação mobile. O `Topbar` flutuante existe em
 * toda rota (mobile e desktop), mas não hospeda navegação — quem decide isso
 * no mobile é a bottom-nav + botão de voltar flutuante + drawer. Destinos do
 * bottom-nav são "abas de topo" — não mostram botão de voltar. Todo o resto
 * (detalhes de job, notas, automações, admin, setup, conta) é sub-página →
 * mostra voltar. Pura e determinística pra ser testável sem DOM/router.
 *
 * Mantenha em sincronia com `mobile-bottom-nav.tsx` (lista `ITEMS`).
 */
export const BOTTOM_NAV_TABS = ['/', '/transcricoes', '/notas', '/grafo'] as const;

/**
 * `true` quando o pathname é exatamente uma aba do bottom-nav ou um alias
 * canônico dela. `/chat` compartilha a semântica da home `/`; detalhes como
 * `/jobs/:id` e `/transcricoes/:id` continuam sendo sub-páginas.
 */
export function isBottomNavTab(pathname: string): boolean {
  return isChatRoute(pathname) || (BOTTOM_NAV_TABS as readonly string[]).includes(pathname);
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

/**
 * `true` para as rotas que renderizam a experiência de chat no shell (`/` e
 * `/chat`) — no mobile `/` agora também é o chat (antes era a Home
 * simplificada). Match exato, igual às demais funções deste módulo.
 */
export function isChatRoute(pathname: string): boolean {
  return pathname === '/chat' || pathname === '/';
}

/**
 * `true` quando a bottom-nav mobile deve ficar oculta nesta rota: rotas com
 * chrome próprio (grafo, que tem a própria barra flutuante) e a rota de chat
 * no mobile (`/` e `/chat`) — lá o rodapé é o promptbox e não deve competir
 * espaço com a barra de navegação. No desktop a bottom-nav nem monta (CSS
 * `md:hidden`), então `isDesktop` só afeta a parte de chat.
 */
export function hidesBottomNav(pathname: string, isDesktop: boolean): boolean {
  return hasOwnMobileChrome(pathname) || (isChatRoute(pathname) && !isDesktop);
}
