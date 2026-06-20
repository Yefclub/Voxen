import { describe, test, expect } from 'bun:test';
import {
  isBottomNavTab,
  showsMobileBack,
  hasOwnMobileChrome,
} from '../src/client/lib/mobile-nav';

describe('isBottomNavTab', () => {
  test('reconhece as abas de topo exatas', () => {
    expect(isBottomNavTab('/chat')).toBe(true);
    expect(isBottomNavTab('/jobs')).toBe(true);
    expect(isBottomNavTab('/transcricoes')).toBe(true);
    expect(isBottomNavTab('/grafo')).toBe(true);
  });

  test('sub-rotas de uma aba não são abas de topo', () => {
    expect(isBottomNavTab('/chat/abc')).toBe(false);
    expect(isBottomNavTab('/jobs/123')).toBe(false);
    expect(isBottomNavTab('/transcricoes/xyz')).toBe(false);
  });

  test('destinos fora do bottom-nav não são abas de topo', () => {
    expect(isBottomNavTab('/dashboard')).toBe(false);
    expect(isBottomNavTab('/notas')).toBe(false);
    expect(isBottomNavTab('/automacoes')).toBe(false);
    expect(isBottomNavTab('/admin/usuarios')).toBe(false);
    expect(isBottomNavTab('/setup')).toBe(false);
    expect(isBottomNavTab('/conta')).toBe(false);
  });
});

describe('showsMobileBack', () => {
  test('abas de topo não mostram voltar', () => {
    expect(showsMobileBack('/chat')).toBe(false);
    expect(showsMobileBack('/grafo')).toBe(false);
  });

  test('sub-páginas e destinos fora do bottom-nav mostram voltar', () => {
    expect(showsMobileBack('/chat/abc')).toBe(true);
    expect(showsMobileBack('/dashboard')).toBe(true);
    expect(showsMobileBack('/notas/123')).toBe(true);
    expect(showsMobileBack('/admin/custos')).toBe(true);
  });
});

describe('hasOwnMobileChrome', () => {
  test('grafo tem chrome próprio (barra flutuante)', () => {
    expect(hasOwnMobileChrome('/grafo')).toBe(true);
    expect(hasOwnMobileChrome('/grafo/node-1')).toBe(true);
  });

  test('demais rotas não têm chrome próprio', () => {
    expect(hasOwnMobileChrome('/chat')).toBe(false);
    expect(hasOwnMobileChrome('/dashboard')).toBe(false);
  });
});
