import { describe, expect, test } from 'bun:test';
import {
  citationFromInlineHref,
  inlineCitationHref,
  renderInlineCitations,
} from '../src/client/lib/chat-inline-citations';
import type { ChatCitation } from '../src/shared/chat-citations';

const verified: ChatCitation = {
  sourceType: 'TRANSCRIPT',
  sourceId: 'source-1',
  title: 'Fonte verificada',
  quote: 'Trecho confirmado',
  context: null,
  fromLine: 3,
  toLine: 4,
  fromSec: null,
  toSec: null,
  href: '/transcricoes/source-1#l=3',
  kind: 'EVIDENCE',
  verified: true,
  inlineOrdinal: 1,
};

describe('citações inline do chat', () => {
  test('transforma somente marcadores associados a evidência verificada', () => {
    expect(renderInlineCitations('Afirmação [[1]] e marcador ausente [[2]].', [verified])).toBe(
      `Afirmação [1](${inlineCitationHref(1)}) e marcador ausente [[2]].`,
    );
  });

  test('não oferece link para evidência desatualizada ou não verificada', () => {
    const stale = { ...verified, sourceId: 'source-2', stale: true };
    const unsupported = {
      ...verified,
      sourceId: 'source-3',
      verified: false,
      kind: 'NO_EVIDENCE' as const,
    };
    expect(renderInlineCitations('[[1]]', [stale, unsupported])).toBe('[[1]]');
    expect(citationFromInlineHref(inlineCitationHref(1), [stale, unsupported])).toBeNull();
  });

  test('resolve o chip inline de volta para sua fonte verificável', () => {
    expect(citationFromInlineHref(inlineCitationHref(1), [verified])).toEqual(verified);
    expect(citationFromInlineHref('#outra-coisa', [verified])).toBeNull();
  });
});
