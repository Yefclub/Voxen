import { describe, test, expect } from 'bun:test';
import {
  BOTTOM_NAV_TABS,
  isBottomNavTab,
  showsMobileBack,
  hasOwnMobileChrome,
  isChatRoute,
  hidesBottomNav,
  shouldResetMobileDrawerForDesktop,
} from './mobile-nav';

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
    '/fila',
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

  test('/chat herda a mesma semântica de topo da rota canônica /', () => {
    expect(isBottomNavTab('/chat')).toBe(true);
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
    '/fila',
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
    for (const p of [
      '/',
      '/dashboard',
      '/jobs/a',
      '/fila',
      '/notas',
      '/grafo',
      '/setup',
      '/chat',
    ]) {
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

describe('isChatRoute', () => {
  test.each(['/', '/chat'])('%s é rota de chat', (path) => {
    expect(isChatRoute(path)).toBe(true);
  });

  test.each([
    '/chat/abc',
    '/transcricoes',
    '/notas',
    '/grafo',
    '/fila',
    '/setup',
    '/conta',
    '/admin/usuarios',
  ])('%s NÃO é rota de chat (match exato)', (path) => {
    expect(isChatRoute(path)).toBe(false);
  });
});

describe('hidesBottomNav', () => {
  test('rota de chat (/) no mobile esconde a bottom-nav', () => {
    expect(hidesBottomNav('/', false)).toBe(true);
  });

  test('rota de chat (/chat) no mobile esconde a bottom-nav', () => {
    expect(hidesBottomNav('/chat', false)).toBe(true);
  });

  test('rota de chat no DESKTOP não esconde (a bottom-nav nem monta lá, mas a decisão não depende disso)', () => {
    expect(hidesBottomNav('/', true)).toBe(false);
    expect(hidesBottomNav('/chat', true)).toBe(false);
  });

  test('grafo esconde a bottom-nav independente de desktop/mobile (chrome próprio)', () => {
    expect(hidesBottomNav('/grafo', false)).toBe(true);
    expect(hidesBottomNav('/grafo', true)).toBe(true);
    expect(hidesBottomNav('/grafo/node-1', false)).toBe(true);
  });

  test.each(['/transcricoes', '/notas', '/fila', '/setup'])(
    '%s mantém a bottom-nav visível no mobile',
    (path) => {
      expect(hidesBottomNav(path, false)).toBe(false);
    },
  );
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

  test.each([
    '/jobs/123',
    '/fila',
    '/notas/abc',
    '/automacoes',
    '/setup',
    '/conta',
    '/admin/usuarios',
  ])('sub-página %s: mostra voltar', (path) => {
    expect(shouldShowBack(path)).toBe(true);
  });

  test('/chat visitada diretamente é alias da home e abre o mesmo menu', () => {
    expect(shouldShowBack('/chat')).toBe(false);
  });
});

describe('reset do drawer ao entrar no desktop', () => {
  test('zera qualquer estado mobile visual ou semântico ao cruzar md', () => {
    expect(shouldResetMobileDrawerForDesktop(true, true, false, 0)).toBe(true);
    expect(shouldResetMobileDrawerForDesktop(true, false, true, 0)).toBe(true);
    expect(shouldResetMobileDrawerForDesktop(true, false, false, 0.4)).toBe(true);
  });

  test('não interfere no gesto mobile nem no desktop já limpo', () => {
    expect(shouldResetMobileDrawerForDesktop(false, true, true, 1)).toBe(false);
    expect(shouldResetMobileDrawerForDesktop(true, false, false, 0)).toBe(false);
  });
});
