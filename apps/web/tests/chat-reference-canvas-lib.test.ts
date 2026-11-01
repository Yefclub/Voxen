import { describe, expect, test } from 'bun:test';
import type { ChatCitation } from '../src/shared/chat-citations';
import { citationCanvasKey, citationCanvasState } from '../src/client/lib/chat-reference-canvas';

const citation = (overrides: Partial<ChatCitation> = {}): ChatCitation => ({
  sourceType: 'TRANSCRIPT',
  sourceId: 'source-a',
  title: 'Source A',
  quote: 'Evidence A',
  context: null,
  fromLine: 12,
  toLine: 14,
  fromSec: null,
  toSec: null,
  href: '/transcricoes/source-a',
  kind: 'EVIDENCE',
  verified: true,
  inlineOrdinal: 1,
  ...overrides,
});

describe('chat reference canvas state contract', () => {
  test('switching references remounts the canvas before new content is requested', () => {
    expect(citationCanvasKey(citation())).not.toBe(
      citationCanvasKey(citation({ sourceId: 'missing-source' })),
    );
  });

  test('preserves verified, unverified and stale evidence semantics', () => {
    expect(citationCanvasState(citation())).toBe('verified');
    expect(citationCanvasState(citation({ verified: false }))).toBe('unverified');
    expect(citationCanvasState(citation({ kind: 'INFERENCE' }))).toBe('unverified');
    expect(citationCanvasState(citation({ stale: true }))).toBe('stale');
  });
});
