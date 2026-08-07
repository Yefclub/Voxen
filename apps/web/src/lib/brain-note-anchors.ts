export interface NoteTranscriptSource {
  anchors: Array<{
    id: string;
    transcriptId: string;
    startLine: number | null;
    endLine: number | null;
    startSec: number | null;
    endSec: number | null;
    selectedQuote: string;
    status: 'VALID' | 'STALE' | 'UNAVAILABLE';
  }>;
}

export function validNoteAnchorSources(sources: NoteTranscriptSource[]): Array<{
  excerpt: string;
  startLine: number | null;
  endLine: number | null;
  startSec: number | null;
  endSec: number | null;
  segmentKey: string;
  evidenceKey: string;
}> {
  return sources.flatMap(({ anchors }) =>
    anchors
      .filter((anchor) => anchor.status === 'VALID')
      .map((anchor) => ({
        excerpt: anchor.selectedQuote,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        startSec: anchor.startSec,
        endSec: anchor.endSec,
        segmentKey: `transcript:${anchor.transcriptId}`,
        evidenceKey: `note-anchor:${anchor.id}`,
      })),
  );
}
