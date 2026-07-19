import { describe, expect, test } from 'bun:test';
import { isTransientStreamDisconnect } from '../src/client/lib/chat-stream-errors';

describe('isTransientStreamDisconnect', () => {
  test('detecta TypeError de fetch/network', () => {
    expect(isTransientStreamDisconnect(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientStreamDisconnect(new TypeError('NetworkError when attempting to fetch'))).toBe(
      true,
    );
    expect(isTransientStreamDisconnect(new TypeError('Load failed'))).toBe(true);
  });

  test('detecta mensagens de transporte em Error genérico', () => {
    expect(isTransientStreamDisconnect(new Error('network error'))).toBe(true);
    expect(isTransientStreamDisconnect(new Error('ECONNRESET'))).toBe(true);
    expect(isTransientStreamDisconnect(new Error('socket hang up'))).toBe(true);
  });

  test('não trata abort do usuário como desconexão de transporte', () => {
    expect(isTransientStreamDisconnect(new DOMException('aborted', 'AbortError'))).toBe(false);
  });

  test('não trata erros de aplicação como transporte', () => {
    expect(isTransientStreamDisconnect(new Error('Mensagem inválida.'))).toBe(false);
    expect(isTransientStreamDisconnect(new Error('OpenRouter 401'))).toBe(false);
    expect(isTransientStreamDisconnect(null)).toBe(false);
    expect(isTransientStreamDisconnect('Failed to fetch')).toBe(false);
  });
});
