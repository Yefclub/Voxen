import { createHash } from 'node:crypto';
import {
  applyTextPatch,
  searchWithinText,
  type AppliedNotePatch,
  type NoteContentMatch,
  type NotePatchOperation,
} from './note-revisions';

export const TRANSCRIPT_CORRECTION_MAX_LENGTH = 2_000_000;
export type TranscriptPatchOperation = NotePatchOperation;

export type TranscriptCorrectionInvariantCode =
  | 'EMPTY_CONTENT'
  | 'FRONTMATTER_CHANGED'
  | 'TIMESTAMPS_CHANGED';

export class TranscriptCorrectionInvariantError extends Error {
  constructor(
    readonly code: TranscriptCorrectionInvariantCode,
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptCorrectionInvariantError';
  }
}

export function applyTranscriptPatch(
  markdown: string,
  operation: TranscriptPatchOperation,
): AppliedNotePatch {
  const applied = applyTextPatch(markdown, operation, {
    maxLength: TRANSCRIPT_CORRECTION_MAX_LENGTH,
  });
  assertTranscriptCorrectionInvariants(markdown, applied.content);
  return applied;
}

export function assertTranscriptCorrectionInvariants(
  previousMarkdown: string,
  nextMarkdown: string,
): void {
  if (frontmatterBlock(previousMarkdown) !== frontmatterBlock(nextMarkdown)) {
    throw new TranscriptCorrectionInvariantError(
      'FRONTMATTER_CHANGED',
      'Correções não podem alterar o frontmatter canônico.',
    );
  }
  const previousTimestamps = timestampMarkers(previousMarkdown);
  const nextTimestamps = timestampMarkers(nextMarkdown);
  let nextIndex = 0;
  for (const marker of previousTimestamps) {
    nextIndex = nextTimestamps.indexOf(marker, nextIndex);
    if (nextIndex < 0) {
      throw new TranscriptCorrectionInvariantError(
        'TIMESTAMPS_CHANGED',
        'Correções devem preservar os marcadores de tempo existentes.',
      );
    }
    nextIndex += 1;
  }
  if (!transcriptMarkdownToPlainText(nextMarkdown).trim()) {
    throw new TranscriptCorrectionInvariantError(
      'EMPTY_CONTENT',
      'A correção precisa manter conteúdo textual pesquisável.',
    );
  }
}

function frontmatterBlock(markdown: string): string | null {
  return markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? null;
}

function timestampMarkers(markdown: string): string[] {
  return [...markdown.matchAll(/^\s*(\[(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\])/gm)].map(
    (match) => match[1]!,
  );
}

export function searchWithinTranscript(
  markdown: string,
  query: string,
  options: { limit?: number; contextChars?: number } = {},
): NoteContentMatch[] {
  return searchWithinText(markdown, query, options);
}

export function transcriptCorrectionChecksum(markdown: string, plainText: string): string {
  return createHash('sha256').update(markdown).update('\0').update(plainText).digest('hex');
}

export function transcriptMarkdownToPlainText(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return withoutFrontmatter
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\[(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]\s*/, '')
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
        .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
        .trimEnd(),
    )
    .join('\n')
    .trim();
}

export function effectiveTranscriptContent(input: {
  plainText: string;
  correctedPlainText: string | null;
  correctedMarkdown: string | null;
  correctionState: 'ACTIVE' | 'STALE';
}): { plainText: string; markdown: string | null; corrected: boolean } {
  const corrected =
    input.correctionState === 'ACTIVE' &&
    input.correctedPlainText !== null &&
    input.correctedMarkdown !== null;
  return {
    plainText: corrected ? input.correctedPlainText! : input.plainText,
    markdown: corrected ? input.correctedMarkdown : null,
    corrected,
  };
}
