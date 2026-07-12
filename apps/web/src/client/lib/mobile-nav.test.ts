import { describe, test, expect } from 'bun:test';
import { BOTTOM_NAV_TABS, isBottomNavTab, showsMobileBack, hasOwnMobileChrome } from './mobile-nav';

describe('isBottomNavTab', () => {
  test.each([...BOTTOM_NAV_TABS])('reconhece a aba de topo %s (match exato)', (tab) => {
    expect(isBottomNavTab(tab)).toBe(true);
  });

  test.each([
    '/dashboard/extra',
    '/jobs/123',
    '/transcricoes/xyz',
    '/grafo/node-1',
    '/dashboard',
    '/jobs',
    '/chat',
    '/chat/abc',
    '/notas/abc',
    '/automacoes',
    '/setup',
    '/conta',
    '/admin/usuarios',
    '/admin/custos',
    '/admin/integracoes',
  ])('NÃO trata %s como aba de topo', (path) => {
    expect(isBottomNavTab(path)).toBe(false);
  });
});

describe('showsMobileBack', () => {
  test.each([...BOTTOM_NAV_TABS])('abas de topo (%s) NÃO mostram voltar', (tab) => {
    expect(showsMobileBack(tab)).toBe(false);
  });

  test.each([
    '/jobs/123',
    '/transcricoes/xyz',
    '/dashboard',
    '/jobs',
    '/notas/abc',
    '/automacoes',
    '/setup',
    '/conta',
    '/admin/usuarios',
    '/admin/custos',
    '/admin/integracoes',
  ])('sub-páginas (%s) mostram voltar', (path) => {
    expect(showsMobileBack(path)).toBe(true);
  });

  test('é o complemento exato de isBottomNavTab', () => {
    for (const p of ['/', '/dashboard', '/jobs/a', '/notas', '/grafo', '/setup', '/chat']) {
      expect(showsMobileBack(p)).toBe(!isBottomNavTab(p));
    }
  });
});

describe('hasOwnMobileChrome', () => {
  test('grafo (raiz e sub-páginas) tem chrome próprio', () => {
    expect(hasOwnMobileChrome('/grafo')).toBe(true);
    expect(hasOwnMobileChrome('/grafo/node-1')).toBe(true);
  });

  test.each(['/', '/notas/abc', '/setup', '/jobs/1'])('%s não tem chrome próprio', (path) => {
    expect(hasOwnMobileChrome(path)).toBe(false);
  });
});

describe('decisão do botão de voltar flutuante (showsMobileBack && !hasOwnMobileChrome)', () => {
  const shouldShowBack = (p: string): boolean => showsMobileBack(p) && !hasOwnMobileChrome(p);

  test('abas de topo: sem voltar', () => {
    expect(shouldShowBack('/')).toBe(false);
    expect(shouldShowBack('/transcricoes')).toBe(false);
    expect(shouldShowBack('/notas')).toBe(false);
  });

  test('/grafo (aba + chrome próprio): sem voltar', () => {
    expect(shouldShowBack('/grafo')).toBe(false);
    expect(shouldShowBack('/grafo/node-1')).toBe(false);
  });

  test.each(['/jobs/123', '/notas/abc', '/automacoes', '/setup', '/conta', '/admin/usuarios'])(
    'sub-página %s: mostra voltar',
    (path) => {
      expect(shouldShowBack(path)).toBe(true);
    },
  );
});
