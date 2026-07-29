import { describe, expect, test } from 'bun:test';
import { graphCacheKey, graphCachePattern, graphInvalidationChannel } from './graph-cache';

describe('cache e atualização em tempo real do grafo', () => {
  test('invalida todas as variantes de view, foco e hops do usuário', () => {
    expect(graphCacheKey('user-1')).toBe('voxen:graph:v4:user-1');
    expect(graphCachePattern('user-1')).toBe('voxen:graph:v4:user-1:*');
    expect(graphCachePattern('user-10')).toBe('voxen:graph:v4:user-10:*');
    expect(graphCachePattern('user-1')).not.toBe(graphCachePattern('user-10'));
  });

  test('isola o canal de atualização por usuário', () => {
    expect(graphInvalidationChannel('user-1')).toBe('voxen:graph:v4:events:user-1');
    expect(graphInvalidationChannel('user-2')).not.toBe(graphInvalidationChannel('user-1'));
  });
});
