// ============================================================================
// Canonical Markdown for captured documents (docs/TRANSCRIPT-FORMAT.md)
// ============================================================================

import type {
  CaptureArtifact,
  CaptureComment,
  CaptureInterpretation,
  CaptureSegment,
} from './types';
import {
  createSourceEvidenceManifest,
  type SourceEvidenceManifest,
  type SourceEvidenceSpan,
} from '../source-provenance';

export type CaptureMarkdownInput = {
  id: string;
  userId: string;
  source: 'youtube' | 'instagram' | 'tiktok' | 'x' | 'web' | 'upload';
  url: string;
  platformId: string | null;
  title: string;
  channel: string | null;
  author: string | null;
  durationSec: number;
  publishedAt: Date | null;
  thumbnail: string | null;
  language: string;
  method: 'subtitles' | 'scrape' | 'api' | 'vision' | 'document';
  model: string | null;
  costUsd: number | null;
  transcribedAt: Date;
  artifact: CaptureArtifact;
  interpretation: CaptureInterpretation;
};

/** JSON strings are valid YAML scalars and need no escaping rules of their own. */
function yamlValue(value: string | number | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return JSON.stringify(value);
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(sec).padStart(2, '0')}s`;
}

function timestampLink(input: CaptureMarkdownInput, seconds: number): string {
  if (input.source === 'youtube' && input.platformId) {
    return `https://youtu.be/${input.platformId}?t=${Math.floor(seconds)}`;
  }
  return input.url;
}

/** Escapes characters that would let captured text start Markdown links. */
export function escapeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/([\\[\]<>])/g, '\\$1')
    .trim();
}

/**
 * Removes links, images, raw URLs and HTML from model output. Captured content
 * is untrusted, so the generated summary must never carry clickable or
 * auto-loading references that a prompt injection could have planted.
 */
export function sanitizeModelText(text: string): string {
  return (
    collapseLinks(stripImages(text))
      // Reference definitions: `[id]: url` lines carry the target of any link.
      .replace(/^[ \t]{0,3}\[[^\]\n]*\]:.*$/gm, '')
      // Escape every `<` instead of stripping tags (tag-stripping regexes are
      // bypassable with nested tags): the renderer never sees raw HTML.
      .replace(/</g, '&lt;')
      .replace(/(?:\b(?:https?|ftp|data|javascript|file|mailto):|\/\/)[^\s)\]]+/gi, '')
      .replace(/\bwww\.\S+/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

const INLINE_LINK = /\[([^[\]]*)\]\([^()]*(?:\([^()]*\)[^()]*)*\)/g;
const REFERENCE_LINK = /\[([^[\]]*)\]\[[^\]]*\]/g;

/** Unwraps `[text](url)` and `[text][ref]` from the innermost brackets out. */
function collapseLinks(text: string): string {
  let current = text;
  for (let i = 0; i < 20; i += 1) {
    const next = current.replace(INLINE_LINK, '$1').replace(REFERENCE_LINK, '$1');
    if (next === current) break;
    current = next;
  }
  return current.replace(/\]\([^)]*\)/g, ']');
}

/**
 * Turns every Markdown image into plain text so nothing auto-loads when the
 * document renders (tracking pixels, prompt-injected beacons). Handles nested
 * brackets and reference-style images by removing the `!` marker itself.
 */
export function stripImages(text: string): string {
  return text.replace(/!(?=\[)/g, '');
}

export function segmentsToPlainText(segments: CaptureSegment[]): string {
  return segments
    .map((segment) => segment.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

/** Captured multi-line text (page, post, description): no remote images, no raw HTML. */
function capturedBody(text: string | null): string {
  return (
    stripImages(text ?? '')
      .replace(/\r\n/g, '\n')
      // Escape every `<` instead of stripping tags (tag-stripping regexes are
      // bypassable with nested tags): the renderer never sees raw HTML.
      .replace(/</g, '&lt;')
      .trim()
  );
}

function bodyPlainText(body: string): string {
  return body.replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();
}

/** One untrusted line: no links, images, raw URLs, HTML or line breaks. */
function untrustedInline(text: string): string {
  return escapeInline(sanitizeModelText(text));
}

/** `## Comentários`, most relevant first (spec 221); comments are untrusted. */
export function commentsMarkdown(comments: CaptureComment[]): string[] {
  const items: string[] = [];
  for (const comment of comments) {
    const text = untrustedInline(comment.text);
    if (!text) continue;
    const author = untrustedInline(comment.author ?? '') || 'Anônimo';
    const likes =
      comment.likes === null
        ? ''
        : ` (${comment.likes} ${comment.likes === 1 ? 'curtida' : 'curtidas'})`;
    items.push(`${items.length + 1}. ${author}${likes}: ${text}`);
  }
  return items.length > 0 ? ['## Comentários', '', ...items, ''] : [];
}

export function buildCaptureMarkdown(input: CaptureMarkdownInput): {
  markdown: string;
  plainText: string;
  evidenceManifest: SourceEvidenceManifest;
} {
  const { artifact, interpretation } = input;
  const front: Array<[string, string | number | null]> = [
    ['id', input.id],
    ['workspace_id', input.userId],
    ['source', input.source],
    ['url', input.url],
    ['video_id', input.platformId],
    ['title', input.title],
    ['channel', input.channel],
    ['author', input.author],
    ['duration_sec', input.durationSec],
    ['published_at', input.publishedAt ? input.publishedAt.toISOString() : null],
    ['thumbnail', input.thumbnail],
    ['language', input.language],
    ['model', input.model],
    ['transcription_method', input.method],
    ['transcribed_at', input.transcribedAt.toISOString()],
    ['cost_usd', input.costUsd],
    ['producer', 'voxen-capture'],
  ];
  const lines: string[] = ['---'];
  const sourceSpans: SourceEvidenceSpan[] = [];
  const pushSource = (body: string[]) => {
    const text = body.join('\n').trimEnd();
    const start = lines.join('\n').length + 1;
    lines.push(...body);
    if (text) sourceSpans.push({ start, end: start + text.length + 1 });
  };
  for (const [key, value] of front) {
    if (value === null && key !== 'cost_usd') continue;
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push('---', '');
  if (input.thumbnail) lines.push(`![thumbnail](${input.thumbnail})`, '');
  lines.push(`# ${escapeInline(input.title)}`, '');
  const header = [`[Original](${input.url})`];
  if (input.channel ?? input.author)
    header.push(escapeInline((input.channel ?? input.author) as string));
  if (input.durationSec > 0) header.push(formatDuration(input.durationSec));
  if (input.publishedAt)
    header.push(`publicado em ${input.publishedAt.toISOString().slice(0, 10)}`);
  lines.push(`> ${header.join(' — ')}`, '');

  const summary = sanitizeModelText(interpretation.summaryMd);
  if (summary) lines.push('## Resumo', '', summary, '');
  const points = interpretation.keyPoints.map(sanitizeModelText).filter(Boolean);
  if (points.length > 0) {
    lines.push('## Pontos-chave', '');
    for (const point of points) lines.push(`- ${point.replace(/\n+/g, ' ')}`);
    lines.push('');
  }

  const descriptions = (artifact.imageDescriptions ?? [])
    .map((item) => sanitizeModelText(item.description))
    .filter(Boolean);
  if (descriptions.length > 0) {
    lines.push('## Imagens', '');
    descriptions.forEach((description, index) =>
      lines.push(`${index + 1}. ${description.replace(/\n+/g, ' ')}`),
    );
    lines.push('');
  }

  const frames = (artifact.frameDescriptions ?? [])
    .map((item) => ({ timeSec: item.timeSec, text: sanitizeModelText(item.description) }))
    .filter((item) => item.text);
  if (frames.length > 0) {
    lines.push('## Quadros do vídeo', '');
    for (const frame of frames) {
      const at = frame.timeSec === null ? '' : `**${formatTimestamp(frame.timeSec)}** `;
      lines.push(`- ${at}${frame.text.replace(/\n+/g, ' ')}`);
    }
    lines.push('');
  }

  // The post text or description stays next to a transcript (spec 221);
  // without one (web pages, posts) the text itself is the content.
  const transcript =
    artifact.segments.length > 0 || artifact.textKind === 'stt' || artifact.textKind === 'captions';
  const description = transcript ? capturedBody(artifact.description) : '';
  const showDescription = description !== '';
  if (showDescription) {
    lines.push('## Descrição', '');
    pushSource([description, '']);
  }

  let plainText: string;
  if (artifact.segments.length > 0) {
    lines.push('## Transcrição', '');
    const transcriptLines: string[] = [];
    for (const segment of artifact.segments) {
      const text = escapeInline(segment.text);
      if (!text) continue;
      transcriptLines.push(
        `[${formatTimestamp(segment.startSec)}](${timestampLink(input, segment.startSec)}) ${text}`,
        '',
      );
    }
    pushSource(transcriptLines);
    plainText = segmentsToPlainText(artifact.segments);
  } else {
    // Captured page Markdown keeps its links but never auto-loads remote
    // images (tracking pixels) or raw HTML when the document is rendered.
    const body = capturedBody(artifact.text);
    if (body) {
      lines.push('## Conteúdo', '');
      pushSource([body, '']);
    }
    plainText = bodyPlainText(body);
  }
  lines.push(...commentsMarkdown(artifact.comments ?? []));
  plainText = [
    plainText,
    showDescription ? bodyPlainText(description) : '',
    ...descriptions,
    ...frames.map((frame) => frame.text),
  ]
    .filter(Boolean)
    .join(' ');

  const markdown = `${lines.join('\n').trimEnd()}\n`;
  return {
    markdown,
    plainText,
    evidenceManifest: createSourceEvidenceManifest(markdown, sourceSpans),
  };
}
