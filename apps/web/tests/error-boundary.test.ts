// ============================================================================
// ErrorBoundary (spec 048) — testa a lógica de captura de erro.
// ============================================================================
// Não há ambiente DOM no `bun test` deste app (testes são lógica/backend), então
// não renderizamos o componente. Validamos o contrato oficial do React: o
// boundary deriva `hasError: true` quando um filho lança, o que dispara o
// fallback. Esse é o ponto load-bearing — render visual é coberto por revisão.
// ============================================================================

import { describe, expect, test } from 'bun:test';
import { ErrorBoundary } from '../src/client/components/error-boundary';

describe('ErrorBoundary', () => {
  test('getDerivedStateFromError marca hasError pra disparar o fallback', () => {
    const next = ErrorBoundary.getDerivedStateFromError();
    expect(next).toEqual({ hasError: true });
  });

  test('componentDidCatch loga o erro no console sem relançar', () => {
    const original = console.error;
    let captured: unknown = null;
    console.error = (...args: unknown[]): void => {
      captured = args[0];
    };
    try {
      const instance = new ErrorBoundary({ children: null });
      const err = new Error('render failed');
      expect(() =>
        instance.componentDidCatch(err, { componentStack: '\n    at Foo' }),
      ).not.toThrow();
      expect(captured).toContain('[ErrorBoundary]');
    } finally {
      console.error = original;
    }
  });
});
