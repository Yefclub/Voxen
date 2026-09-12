import { describe, expect, test } from 'bun:test';
import type { ChatCitation } from '../../shared/chat-citations';
import {
  citationFromInlineHref,
  inlineCitationHref,
  renderInlineCitations,
} from './chat-inline-citations';

const citation = (overrides: Partial<ChatCitation> = {}): ChatCitation => ({
  sourceType: 'TRANSCRIPT',
  sourceId: 'transcript-a',
  title: 'Transcript A',
  quote: 'Evidence A',
  context: null,
  fromLine: 12,
  toLine: 14,
  fromSec: null,
  toSec: null,
  href: '/transcricoes/transcript-a',
  kind: 'EVIDENCE',
  verified: true,
  inlineOrdinal: 1,
  ...overrides,
});

describe('inline chat citations', () => {
  test('renders a web source as an inline citation', () => {
    const web = citation({
      sourceType: 'WEB',
      sourceId: 'https://github.com/example/source',
      title: 'Example source',
      quote: 'External evidence',
      href: 'https://github.com/example/source',
      kind: 'INFERENCE',
      verified: false,
    });

    expect(renderInlineCitations('Found it [[1]].', [web])).toBe(
      `Found it [1](${inlineCitationHref(1)}).`,
    );
    expect(citationFromInlineHref(inlineCitationHref(1), [web])).toEqual(web);
  });

  test('hides unresolved internal markers instead of exposing them to the user', () => {
    expect(renderInlineCitations('Found it [[1]].', [])).toBe('Found it .');
    expect(renderInlineCitations('Keep [[2]] and render [[1]].', [citation()])).toBe(
      `Keep  and render [1](${inlineCitationHref(1)}).`,
    );
  });
});
