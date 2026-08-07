import type { Prisma } from '../../prisma-generated/client';

export const noteBrainSelect = {
  id: true,
  parentId: true,
  kind: true,
  title: true,
  content: true,
  updatedAt: true,
  transcriptSources: {
    select: {
      anchors: {
        select: {
          id: true,
          transcriptId: true,
          startLine: true,
          endLine: true,
          startSec: true,
          endSec: true,
          selectedQuote: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.NoteSelect;

export type NoteBrainRecord = Prisma.NoteGetPayload<{ select: typeof noteBrainSelect }>;

export function buildNoteIndexes(notes: NoteBrainRecord[]): {
  byId: Map<string, NoteBrainRecord>;
  byTitle: Map<string, NoteBrainRecord>;
} {
  return {
    byId: new Map(notes.map((note) => [note.id, note])),
    byTitle: new Map(notes.map((note) => [note.title.trim().toLowerCase(), note])),
  };
}

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
