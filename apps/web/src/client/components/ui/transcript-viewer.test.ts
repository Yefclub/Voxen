import { describe, expect, it } from 'bun:test';
import {
  groupTranscriptAnchorsByLine,
  transcriptAnchorHash,
  type TranscriptViewerAnchor,
} from './transcript-viewer';

const segments = [
  { line: 10, startSec: 0 },
  { line: 11, startSec: 12 },
  { line: 12, startSec: 25 },
];

function anchor(overrides: Partial<TranscriptViewerAnchor>): TranscriptViewerAnchor {
  return {
    id: 'anchor-1',
    startLine: null,
    endLine: null,
    startSec: null,
    endSec: null,
    selectedQuote: 'Trecho verificável',
    status: 'VALID',
    ...overrides,
  };
}

describe('transcript annotation markers', () => {
  it('places line anchors beside the first referenced transcript segment', () => {
    const noteAnchor = anchor({ startLine: 11, endLine: 12 });
    expect(transcriptAnchorHash(noteAnchor)).toBe('#l=11-12');
    expect(groupTranscriptAnchorsByLine(segments, [noteAnchor]).get(11)).toEqual([noteAnchor]);
  });

  it('maps timestamp anchors to the nearest preceding segment', () => {
    const noteAnchor = anchor({ id: 'anchor-time', startSec: 14, endSec: 28 });
    expect(transcriptAnchorHash(noteAnchor)).toBe('#t=14-28');
    expect(groupTranscriptAnchorsByLine(segments, [noteAnchor]).get(11)).toEqual([noteAnchor]);
  });
});
