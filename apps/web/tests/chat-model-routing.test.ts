import { describe, expect, it } from 'bun:test';
import { normalizeOpenRouterError } from '../src/lib/chat/model-routing';

function providerError(statusCode: number): Error {
  return Object.assign(
    new Error(
      'provider body with Bearer secret-token and https://provider.test?token=query-secret',
    ),
    { statusCode },
  );
}

describe('normalizeOpenRouterError', () => {
  it.each([
    [400, 'A OpenRouter recusou a solicitação.'],
    [401, 'A OpenRouter recusou a autenticação.'],
    [402, 'A conta da OpenRouter não possui créditos suficientes'],
    [403, 'A OpenRouter recusou a autenticação.'],
    [500, 'O provedor está temporariamente indisponível.'],
  ])('maps HTTP %i to a stable public message', (statusCode, expected) => {
    const message = normalizeOpenRouterError(providerError(statusCode));

    expect(message).toContain(expected);
    expect(message).not.toContain('secret-token');
    expect(message).not.toContain('query-secret');
    expect(message).not.toContain('provider body');
  });

  it('recognizes rate limits without exposing the provider body', () => {
    const message = normalizeOpenRouterError(
      new Error('Provider returned 429: Bearer secret-token'),
    );

    expect(message).toContain('limite temporário');
    expect(message).not.toContain('secret-token');
  });

  it('keeps the known local setup instruction and hides unknown errors', () => {
    expect(
      normalizeOpenRouterError(new Error('Conclua a configuração da OpenRouter em Configurações.')),
    ).toBe('Conclua a configuração da OpenRouter em Configurações.');
    expect(normalizeOpenRouterError(new Error('private provider diagnostic'))).toBe(
      'Falha inesperada ao gerar a resposta.',
    );
  });
});
