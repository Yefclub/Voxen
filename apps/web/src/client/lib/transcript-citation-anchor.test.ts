import { describe, expect, it } from 'bun:test';
import { resolveTranscriptCitationRange } from './transcript-citation-anchor';

const segments = [
  { startSec: 0, line: 10 },
  { startSec: 30, line: 20 },
  { startSec: 60, line: 30 },
];

describe('transcript citation ranges', () => {
  it('resolves line ranges to canonical segment lines', () => {
    expect(resolveTranscriptCitationRange(segments, '#l=22-31')).toEqual({
      startLine: 20,
      endLine: 30,
    });
  });

  it('resolves timestamp ranges to canonical segment lines', () => {
    expect(resolveTranscriptCitationRange(segments, '#t=35-75')).toEqual({
      startLine: 20,
      endLine: 30,
    });
  });

  it('rejects inverted, incomplete, and out-of-source ranges', () => {
    expect(resolveTranscriptCitationRange(segments, '#l=30-20')).toBeNull();
    expect(resolveTranscriptCitationRange(segments, '#t=5-')).toBeNull();
    expect(resolveTranscriptCitationRange(segments, '#l=1')).toBeNull();
  });
});
