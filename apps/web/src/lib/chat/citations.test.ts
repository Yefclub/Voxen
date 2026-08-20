import { describe, expect, test } from 'bun:test';
import { webCitationsFromToolEvents } from './external-citations';

describe('web chat citations', () => {
  test('projects valid web-search sources into deduplicated inline citations', () => {
    const citations = webCitationsFromToolEvents([
      {
        name: 'web_search',
        state: 'completed',
        output: {
          citations: [
            { url: 'https://example.com/a', title: 'Source A', content: 'Evidence A' },
            { url: 'https://example.com/a', title: 'Source A', content: 'Evidence A' },
            { url: 'javascript:alert(1)', title: 'Unsafe', content: 'Unsafe' },
          ],
        },
      },
    ]);

    expect(citations).toEqual([
      expect.objectContaining({
        sourceType: 'WEB',
        sourceId: 'https://example.com/a',
        href: 'https://example.com/a',
        inlineOrdinal: 1,
        verified: false,
      }),
    ]);
  });

  test('keeps one global ordinal in web-search call order', () => {
    const citations = webCitationsFromToolEvents([
      {
        name: 'web_search',
        state: 'completed',
        output: { citations: [{ url: 'https://example.com/first' }] },
      },
      {
        name: 'search_x',
        state: 'completed',
        output: {
          citations: [{ url: 'https://example.com/first' }, { url: 'https://example.com/second' }],
        },
      },
    ]);

    expect(citations.map(({ href, inlineOrdinal }) => ({ href, inlineOrdinal }))).toEqual([
      { href: 'https://example.com/first', inlineOrdinal: 1 },
      { href: 'https://example.com/second', inlineOrdinal: 2 },
    ]);
  });
});
