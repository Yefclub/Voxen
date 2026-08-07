import { describe, expect, it } from 'bun:test';
import { validNoteAnchorSources } from './brain-note-anchors';

describe('anchored note Brain provenance', () => {
  it('keeps valid passages with deterministic evidence keys', () => {
    expect(
      validNoteAnchorSources([
        {
          anchors: [
            {
              id: 'anchor-1',
              transcriptId: 'transcript-1',
              startLine: 10,
              endLine: 12,
              startSec: 30,
              endSec: 45,
              selectedQuote: 'Verified evidence',
              status: 'VALID',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        excerpt: 'Verified evidence',
        startLine: 10,
        endLine: 12,
        startSec: 30,
        endSec: 45,
        segmentKey: 'transcript:transcript-1',
        evidenceKey: 'note-anchor:anchor-1',
      },
    ]);
  });

  it('drops stale evidence without deleting the note source', () => {
    expect(
      validNoteAnchorSources([
        {
          anchors: [
            {
              id: 'anchor-stale',
              transcriptId: 'transcript-1',
              startLine: 1,
              endLine: 1,
              startSec: null,
              endSec: null,
              selectedQuote: 'Old evidence',
              status: 'STALE',
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
});
