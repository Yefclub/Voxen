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

export function applyTranscriptPatch(
  markdown: string,
  operation: TranscriptPatchOperation,
): AppliedNotePatch {
  return applyTextPatch(markdown, operation, { maxLength: TRANSCRIPT_CORRECTION_MAX_LENGTH });
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
