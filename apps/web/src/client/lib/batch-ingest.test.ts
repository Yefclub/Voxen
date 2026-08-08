import { describe, expect, it } from 'bun:test';
import { MAX_BATCH_URLS, parseBatchUrls } from './batch-ingest';

describe('batch ingest input', () => {
  it('accepts line breaks and pasted whitespace while preserving order', () => {
    expect(
      parseBatchUrls(' https://example.com/a\n\nhttps://example.com/b https://example.com/c '),
    ).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
  });

  it('publishes the same 20-item bound used by the API and tools', () => {
    expect(MAX_BATCH_URLS).toBe(20);
  });
});
