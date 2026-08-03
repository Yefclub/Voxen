import { describe, expect, test } from 'bun:test';
import { countCitationSources } from '../src/client/lib/chat-citation-summary';

describe('resumo de fontes do chat', () => {
  test('conta cada transcrição uma vez mesmo com múltiplas evidências', () => {
    expect(
      countCitationSources([
        { sourceId: 'transcript-a' },
        { sourceId: 'transcript-a' },
        { sourceId: 'transcript-b' },
      ]),
    ).toBe(2);
  });
});
