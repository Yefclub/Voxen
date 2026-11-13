/** Canonical task destinations; legacy chat URLs redirect to the library. */
export const BOTTOM_NAV_TABS = ['/transcricoes', '/capturar', '/notas', '/grafo'] as const;
export function isBottomNavTab(pathname: string): boolean {
  return pathname === '/' || (BOTTOM_NAV_TABS as readonly string[]).includes(pathname);
}
export function shouldResetMobileDrawerForDesktop(
  isDesktop: boolean,
  open: boolean,
  present: boolean,
  progress: number,
): boolean {
  return isDesktop && (open || present || progress > 0.001);
}
export function showsMobileBack(pathname: string): boolean {
  return !isBottomNavTab(pathname);
}
export function hasOwnMobileChrome(pathname: string): boolean {
  return pathname === '/chat' || pathname === '/grafo' || pathname.startsWith('/grafo/');
}
export function isChatRoute(pathname: string): boolean {
  return pathname === '/chat' || pathname === '/';
}
export function hidesBottomNav(pathname: string, _isDesktop: boolean): boolean {
  return hasOwnMobileChrome(pathname);
}
