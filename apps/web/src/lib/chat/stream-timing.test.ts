import { describe, expect, test } from 'bun:test';
import { isProviderObservedEvent } from './stream-timing';

describe('métrica do primeiro evento do provedor', () => {
  test('ignora eventos sintéticos emitidos localmente pelo AI SDK', () => {
    expect(isProviderObservedEvent('start')).toBe(false);
    expect(isProviderObservedEvent('start-step')).toBe(false);
    expect(isProviderObservedEvent('abort')).toBe(false);
    expect(isProviderObservedEvent(undefined)).toBe(false);
  });

  test('encerra a espera no primeiro evento observado do modelo ou ferramenta', () => {
    for (const type of [
      'reasoning-start',
      'reasoning-delta',
      'text-start',
      'text-delta',
      'tool-call',
      'source',
      'file',
      'finish-step',
    ]) {
      expect(isProviderObservedEvent(type), type).toBe(true);
    }
  });
});
