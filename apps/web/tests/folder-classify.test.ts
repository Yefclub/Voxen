import { describe, expect, test } from 'bun:test';
import { resolveFolderDecision } from '../src/lib/folder-classify';

describe('resolveFolderDecision', () => {
  test('NONE variants return null', () => {
    expect(resolveFolderDecision('NONE', ['Anime'])).toBeNull();
    expect(resolveFolderDecision('nenhuma', ['Anime'])).toBeNull();
    expect(resolveFolderDecision('{"folder":null}', [])).toBeNull();
  });

  test('reuses existing folder case-insensitively', () => {
    expect(resolveFolderDecision('anime', ['Anime', 'Produtividade'])).toBe('Anime');
  });

  test('parses JSON folder object', () => {
    expect(resolveFolderDecision('{"folder":"HyperDX"}', [])).toBe('HyperDX');
    expect(resolveFolderDecision('```json\n{"folder":"Elden Ring"}\n```', [])).toBe('Elden Ring');
  });

  test('strips "The content is about" and keeps product name', () => {
    expect(resolveFolderDecision('The content is about Alibaba Cloud', [])).toBe('Alibaba Cloud');
    expect(resolveFolderDecision('The content is about HyperDX, an', [])).toBe('HyperDX');
    expect(resolveFolderDecision('The content is about an Elden Ring game', [])).toBe(
      'Elden Ring game',
    );
    expect(resolveFolderDecision('The content is about using Claude Code', [])).toBe('Claude Code');
    expect(resolveFolderDecision('The content is about "Loop Engineer"', [])).toBe('Loop Engineer');
    expect(resolveFolderDecision('The content is about "Observe", a', [])).toBe('Observe');
  });

  test('rejects meta / user-instruction garbage', () => {
    expect(resolveFolderDecision('The user wants me to categorize the', [])).toBeNull();
    expect(resolveFolderDecision('The user is asking me to categorize', [])).toBeNull();
    expect(resolveFolderDecision('The user is explaining why they stopped', [])).toBeNull();
    expect(resolveFolderDecision('The content is about a library called', [])).toBeNull();
    expect(resolveFolderDecision('The content is about a tool called', [])).toBeNull();
    expect(resolveFolderDecision('The content is about an open-source', [])).toBeNull();
    expect(resolveFolderDecision('The content is about a shift from', [])).toBeNull();
    expect(resolveFolderDecision('The content is about UX engineering for', [])).toBeNull();
  });

  test('does not collide short substring (IA vs História)', () => {
    expect(resolveFolderDecision('História do Brasil', ['IA'])).toBe('História do Brasil');
  });

  test('returns sanitized new name', () => {
    expect(resolveFolderDecision('  Machine Learning  ', [])).toBe('Machine Learning');
  });
});
