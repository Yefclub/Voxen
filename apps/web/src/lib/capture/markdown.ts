// ============================================================================
// Canonical Markdown for captured documents (docs/TRANSCRIPT-FORMAT.md)
// ============================================================================

import type { CaptureArtifact, CaptureInterpretation, CaptureSegment } from './types';

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
function escapeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/([[\]<>])/g, '\\$1')
    .trim();
}

/**
 * Removes links, images, raw URLs and HTML from model output. Captured content
 * is untrusted, so the generated summary must never carry clickable or
 * auto-loading references that a prompt injection could have planted.
 */
export function sanitizeModelText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\b(?:https?|ftp|data|javascript):\/\/?\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function segmentsToPlainText(segments: CaptureSegment[]): string {
  return segments
    .map((segment) => segment.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

export function buildCaptureMarkdown(input: CaptureMarkdownInput): {
  markdown: string;
  plainText: string;
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

  let plainText: string;
  if (artifact.segments.length > 0) {
    lines.push('## Transcrição', '');
    for (const segment of artifact.segments) {
      const text = escapeInline(segment.text);
      if (!text) continue;
      lines.push(
        `[${formatTimestamp(segment.startSec)}](${timestampLink(input, segment.startSec)}) ${text}`,
        '',
      );
    }
    plainText = segmentsToPlainText(artifact.segments);
  } else {
    // Captured page Markdown keeps its links but never auto-loads remote
    // images (tracking pixels) or raw HTML when the document is rendered.
    const body = (artifact.text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (body) lines.push('## Conteúdo', '', body, '');
    plainText = body.replace(/\s+/g, ' ').trim();
  }
  if (descriptions.length > 0) plainText = [plainText, ...descriptions].filter(Boolean).join(' ');

  return { markdown: `${lines.join('\n').trimEnd()}\n`, plainText };
}
