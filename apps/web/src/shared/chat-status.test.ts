import { describe, expect, test } from 'bun:test';
import { chatStatusI18nKey } from './chat-status';

describe('status estruturado do chat', () => {
  test('mapeia estados canônicos para traduções da interface', () => {
    expect(chatStatusI18nKey('preparing-response')).toBe('chat.status.preparingResponse');
    expect(chatStatusI18nKey('connecting-model')).toBe('chat.status.connectingModel');
    expect(chatStatusI18nKey(undefined)).toBeNull();
  });
});
