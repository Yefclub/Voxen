import { describe, expect, test } from 'bun:test';
import { resolveFolderDecision } from '../src/lib/folder-classify';

describe('resolveFolderDecision', () => {
  test('NONE variants return null', () => {
    expect(resolveFolderDecision('NONE', ['Anime'])).toBeNull();
    expect(resolveFolderDecision('nenhuma', ['Anime'])).toBeNull();
  });

  test('reuses existing folder case-insensitively', () => {
    expect(resolveFolderDecision('anime', ['Anime', 'Produtividade'])).toBe('Anime');
  });

  test('does not collide short substring (IA vs História)', () => {
    expect(resolveFolderDecision('História do Brasil', ['IA'])).toBe('História do Brasil');
  });

  test('returns sanitized new name', () => {
    expect(resolveFolderDecision('  Machine Learning  ', [])).toBe('Machine Learning');
  });
});
