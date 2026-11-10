// ============================================================================
// Comments (spec 221): normalization and ranking of what the worker relays,
// and the prompt block. Comments are untrusted: they cannot close the
// <source> block of the prompt. Document rendering lives in markdown.ts.
// ============================================================================

import type { CaptureComment } from './types';

const MAX_COMMENTS = 50;
const MAX_COMMENT_CHARS = 1_000;
const MAX_COMMENT_AUTHOR_CHARS = 200;

function stringOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, max).trim();
  return text || null;
}

/**
 * At most 50 comments with bounded fields, re-sorted defensively: likes desc,
 * then publishedAt desc, unknown values last, worker order as the tie-break.
 */
export function normalizeComments(value: unknown): CaptureComment[] {
  if (!Array.isArray(value)) return [];
  const comments: CaptureComment[] = [];
  for (const item of value.slice(0, MAX_COMMENTS * 2)) {
    const raw = item as Record<string, unknown> | null;
    const text = stringOrNull(raw?.text, MAX_COMMENT_CHARS);
    if (!text) continue;
    const likes = typeof raw?.likes === 'number' && Number.isFinite(raw.likes) ? raw.likes : null;
    const published = stringOrNull(raw?.publishedAt, 40);
    comments.push({
      author: stringOrNull(raw?.author, MAX_COMMENT_AUTHOR_CHARS),
      text,
      likes: likes === null ? null : Math.max(0, Math.floor(likes)),
      publishedAt: published && !Number.isNaN(Date.parse(published)) ? published : null,
    });
  }
  const time = (c: CaptureComment) => (c.publishedAt ? Date.parse(c.publishedAt) : null);
  return comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => {
      const la = a.comment.likes;
      const lb = b.comment.likes;
      if (la === null || lb === null) {
        if (la !== lb) return la === null ? 1 : -1;
      } else if (la !== lb) return lb - la;
      const ta = time(a.comment);
      const tb = time(b.comment);
      if (ta === null || tb === null) {
        if (ta !== tb) return ta === null ? 1 : -1;
      } else if (ta !== tb) return tb - ta;
      return a.index - b.index;
    })
    .slice(0, MAX_COMMENTS)
    .map(({ comment }) => comment);
}

/** At most this many chars of comments enter the interpretation prompt. */
export const MAX_PROMPT_COMMENT_CHARS = 20_000;

/** Removes the angle brackets a comment would need to close a prompt block. */
function promptSafe(text: string): string {
  return text.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

function likesLabel(likes: number | null): string {
  return likes === null ? '' : ` [${likes} likes]`;
}

/** Comment lines for the prompt, most relevant first, capped at 20,000 chars. */
export function commentsPromptBlock(comments: CaptureComment[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const comment of comments) {
    const author = promptSafe(comment.author ?? 'anonymous') || 'anonymous';
    const line = `- ${author}${likesLabel(comment.likes)}: ${promptSafe(comment.text)}`;
    if (used + line.length + 1 > MAX_PROMPT_COMMENT_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
