import { createHash } from 'node:crypto';

export const NOTE_CONTENT_MAX_LENGTH = 200_000;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_CONTEXT_CHARS = 120;
const MAX_CONTEXT_CHARS = 500;

export type NotePatchOperation =
  | {
      kind: 'replace' | 'insert_before' | 'insert_after';
      target: string;
      text: string;
      occurrence?: number;
    }
  | { kind: 'prepend' | 'append'; text: string };

export type NotePatchErrorCode =
  | 'EMPTY_PATCH'
  | 'EMPTY_TARGET'
  | 'TARGET_NOT_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'INVALID_OCCURRENCE'
  | 'NO_CHANGE'
  | 'CONTENT_TOO_LARGE';

export class NotePatchError extends Error {
  readonly code: NotePatchErrorCode;
  readonly matchCount?: number;

  constructor(code: NotePatchErrorCode, message: string, matchCount?: number) {
    super(message);
    this.name = 'NotePatchError';
    this.code = code;
    this.matchCount = matchCount;
  }
}

export type AppliedNotePatch = {
  content: string;
  matchCount: number;
  start: number;
  end: number;
  startLine: number;
  before: string;
  after: string;
};

export type NoteContentMatch = {
  occurrence: number;
  start: number;
  end: number;
  line: number;
  matchedText: string;
  context: string;
  contextStart: number;
  contextEnd: number;
};

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function exactTargetOffsets(content: string, target: string): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  while (cursor <= content.length - target.length) {
    const index = content.indexOf(target, cursor);
    if (index < 0) break;
    offsets.push(index);
    cursor = index + target.length;
  }
  return offsets;
}

function validateResult(content: string, previous: string): void {
  if (content === previous) {
    throw new NotePatchError('NO_CHANGE', 'Patch does not change the note content.');
  }
  if (content.length > NOTE_CONTENT_MAX_LENGTH) {
    throw new NotePatchError(
      'CONTENT_TOO_LARGE',
      `Patched content exceeds the maximum size of ${NOTE_CONTENT_MAX_LENGTH} characters.`,
    );
  }
}

export function applyNotePatch(content: string, operation: NotePatchOperation): AppliedNotePatch {
  if (!operation.text) {
    throw new NotePatchError('EMPTY_PATCH', 'Patch text cannot be empty.');
  }

  if (operation.kind === 'prepend' || operation.kind === 'append') {
    const start = operation.kind === 'prepend' ? 0 : content.length;
    const next = operation.kind === 'prepend' ? operation.text + content : content + operation.text;
    validateResult(next, content);
    return {
      content: next,
      matchCount: 0,
      start,
      end: start,
      startLine: lineAt(content, start),
      before: '',
      after: operation.text,
    };
  }

  if (!('target' in operation) || !operation.target) {
    throw new NotePatchError('EMPTY_TARGET', 'Patch target cannot be empty.');
  }
  const offsets = exactTargetOffsets(content, operation.target);
  if (offsets.length === 0) {
    throw new NotePatchError('TARGET_NOT_FOUND', 'Patch target was not found.', 0);
  }
  if (operation.occurrence === undefined && offsets.length > 1) {
    throw new NotePatchError(
      'AMBIGUOUS_TARGET',
      `Patch target is ambiguous (${offsets.length} matches); select an occurrence.`,
      offsets.length,
    );
  }
  const occurrence = operation.occurrence ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > offsets.length) {
    throw new NotePatchError(
      'INVALID_OCCURRENCE',
      `Patch occurrence must be between 1 and ${offsets.length}.`,
      offsets.length,
    );
  }
  const targetStart = offsets[occurrence - 1] as number;
  const targetEnd = targetStart + operation.target.length;
  const start = operation.kind === 'insert_after' ? targetEnd : targetStart;
  const end = operation.kind === 'replace' ? targetEnd : start;
  const before = operation.kind === 'replace' ? operation.target : '';
  const next = content.slice(0, start) + operation.text + content.slice(end);
  validateResult(next, content);
  return {
    content: next,
    matchCount: offsets.length,
    start,
    end,
    startLine: lineAt(content, start),
    before,
    after: operation.text,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchWithinNote(
  content: string,
  query: string,
  options: { limit?: number; contextChars?: number } = {},
): NoteContentMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, options.limit ?? DEFAULT_SEARCH_LIMIT));
  const contextChars = Math.max(
    0,
    Math.min(MAX_CONTEXT_CHARS, options.contextChars ?? DEFAULT_CONTEXT_CHARS),
  );
  const matches: NoteContentMatch[] = [];
  const matcher = new RegExp(escapeRegExp(needle), 'giu');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content)) !== null && matches.length < limit) {
    const start = match.index;
    const end = start + match[0].length;
    const contextStart = Math.max(0, start - contextChars);
    const contextEnd = Math.min(content.length, end + contextChars);
    matches.push({
      occurrence: matches.length + 1,
      start,
      end,
      line: lineAt(content, start),
      matchedText: content.slice(start, end),
      context: content.slice(contextStart, contextEnd),
      contextStart,
      contextEnd,
    });
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return matches;
}

export function noteContentChecksum(title: string, content: string): string {
  return createHash('sha256').update(title).update('\0').update(content).digest('hex');
}

export function summarizeNotePatch(operation: NotePatchOperation): string {
  switch (operation.kind) {
    case 'replace':
      return `Replace exact passage${operation.occurrence ? ` (occurrence ${operation.occurrence})` : ''}`;
    case 'insert_before':
      return `Insert before exact passage${operation.occurrence ? ` (occurrence ${operation.occurrence})` : ''}`;
    case 'insert_after':
      return `Insert after exact passage${operation.occurrence ? ` (occurrence ${operation.occurrence})` : ''}`;
    case 'prepend':
      return 'Prepend note content';
    case 'append':
      return 'Append note content';
  }
}
