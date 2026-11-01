import { db } from './db';
import { storageReadText } from './storage';

export const TRANSCRIPT_CORRECTION_DETAIL_SELECT = {
  correctionRevision: true,
  correctedMarkdown: true,
  correctedPlainText: true,
  correctedChecksum: true,
  correctionSourceVersion: true,
  correctionSourceChecksum: true,
  correctionState: true,
  correctionStaleReason: true,
} as const;

type EffectivePlainTextInput = {
  plainText: string;
  correctedPlainText: string | null;
  correctionState: string;
};

export function effectiveTranscriptPlainText(input: EffectivePlainTextInput): string {
  return input.correctionState === 'ACTIVE' && input.correctedPlainText
    ? input.correctedPlainText
    : input.plainText;
}

export type TranscriptReadErrorCode = 'NOT_FOUND' | 'UNAVAILABLE_SOURCE' | 'STALE_REVISION';

export class TranscriptReadError extends Error {
  readonly code: TranscriptReadErrorCode;
  readonly current?: { correctionRevision: number; sourceVersion: number };

  constructor(
    code: TranscriptReadErrorCode,
    message: string,
    current?: { correctionRevision: number; sourceVersion: number },
  ) {
    super(message);
    this.name = 'TranscriptReadError';
    this.code = code;
    this.current = current;
  }
}

export type TranscriptReadOptions = {
  expectedCorrectionRevision?: number;
  expectedSourceVersion?: number;
};

export type TranscriptReadDoc = {
  id: string;
  title: string;
  url: string;
  md: string;
  correctionRevision: number;
  sourceVersion: number;
};

// Version-aware bounded cache (spec 216 §4): repeated narrow reads reuse the
// parsed source without re-reading storage. Keyed by owner + document +
// correction/source revision, so writes invalidate implicitly (old keys stop
// being requested). Bounded by entries and bytes (LRU eviction).
const CACHE_MAX_ENTRIES = 50;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;

type CacheEntry = { md: string; bytes: number };
const readCache = new Map<string, CacheEntry>();
let cacheBytes = 0;
let cacheHits = 0;
let cacheMisses = 0;

function cacheKey(
  userId: string,
  transcriptId: string,
  correctionRevision: number,
  sourceVersion: number,
): string {
  return `${userId}:${transcriptId}:${correctionRevision}:${sourceVersion}`;
}

function cacheGet(key: string): string | null {
  const entry = readCache.get(key);
  if (!entry) return null;
  // Refresh recency.
  readCache.delete(key);
  readCache.set(key, entry);
  cacheHits += 1;
  return entry.md;
}

function cachePut(key: string, md: string): void {
  const bytes = Buffer.byteLength(md, 'utf8');
  if (bytes > CACHE_MAX_BYTES) return;
  const existing = readCache.get(key);
  if (existing) {
    cacheBytes -= existing.bytes;
    readCache.delete(key);
  }
  while (
    (readCache.size >= CACHE_MAX_ENTRIES || cacheBytes + bytes > CACHE_MAX_BYTES) &&
    readCache.size > 0
  ) {
    const oldest = readCache.keys().next();
    if (oldest.done) break;
    const evicted = readCache.get(oldest.value);
    readCache.delete(oldest.value);
    if (evicted) cacheBytes -= evicted.bytes;
  }
  readCache.set(key, { md, bytes });
  cacheBytes += bytes;
}

export function getTranscriptReadCacheStats(): {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
} {
  return { entries: readCache.size, bytes: cacheBytes, hits: cacheHits, misses: cacheMisses };
}

/** Test-only reset (isolates cache assertions between cases). */
export function clearTranscriptReadCache(): void {
  readCache.clear();
  cacheBytes = 0;
  cacheHits = 0;
  cacheMisses = 0;
}

/** Drop every cached entry for one document (e.g. right after a correction commit). */
export function invalidateTranscriptReadCache(userId: string, transcriptId: string): void {
  const prefix = `${userId}:${transcriptId}:`;
  for (const key of [...readCache.keys()]) {
    if (key.startsWith(prefix)) {
      const entry = readCache.get(key);
      readCache.delete(key);
      if (entry) cacheBytes -= entry.bytes;
    }
  }
}

export async function loadEffectiveTranscriptMarkdown(
  userId: string,
  transcriptId: string,
  options: TranscriptReadOptions = {},
): Promise<TranscriptReadDoc> {
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: 'ACTIVE' },
    select: {
      id: true,
      title: true,
      url: true,
      mdPath: true,
      correctedMarkdown: true,
      correctionState: true,
      correctionRevision: true,
      sourceVersion: true,
    },
  });
  if (!transcript) {
    throw new TranscriptReadError(
      'NOT_FOUND',
      'Transcrição não encontrada (ou fora do escopo do token).',
    );
  }
  if (
    (options.expectedCorrectionRevision !== undefined &&
      options.expectedCorrectionRevision !== transcript.correctionRevision) ||
    (options.expectedSourceVersion !== undefined &&
      options.expectedSourceVersion !== transcript.sourceVersion)
  ) {
    throw new TranscriptReadError('STALE_REVISION', 'Revisão desatualizada: releia o documento.', {
      correctionRevision: transcript.correctionRevision,
      sourceVersion: transcript.sourceVersion,
    });
  }
  if (transcript.correctionState === 'ACTIVE' && transcript.correctedMarkdown) {
    return {
      id: transcript.id,
      title: transcript.title,
      url: transcript.url,
      md: transcript.correctedMarkdown,
      correctionRevision: transcript.correctionRevision,
      sourceVersion: transcript.sourceVersion,
    };
  }
  const key = cacheKey(
    userId,
    transcript.id,
    transcript.correctionRevision,
    transcript.sourceVersion,
  );
  const cached = cacheGet(key);
  if (cached !== null) {
    return {
      id: transcript.id,
      title: transcript.title,
      url: transcript.url,
      md: cached,
      correctionRevision: transcript.correctionRevision,
      sourceVersion: transcript.sourceVersion,
    };
  }
  cacheMisses += 1;
  let markdown: string;
  try {
    markdown = await storageReadText(transcript.mdPath);
  } catch {
    throw new TranscriptReadError(
      'UNAVAILABLE_SOURCE',
      'Fonte canônica indisponível no storage; o conteúdo armazenado não pôde ser lido.',
    );
  }
  if (!markdown) {
    throw new TranscriptReadError(
      'UNAVAILABLE_SOURCE',
      'Fonte canônica vazia ou ilegível no storage.',
    );
  }
  cachePut(key, markdown);
  return {
    id: transcript.id,
    title: transcript.title,
    url: transcript.url,
    md: markdown,
    correctionRevision: transcript.correctionRevision,
    sourceVersion: transcript.sourceVersion,
  };
}

export async function resolveTranscriptMarkdownViews(input: {
  title: string;
  mdPath: string;
  plainText: string;
  correctedMarkdown: string | null;
  correctionState: string;
  correctionRevision: number;
}): Promise<{ markdown: string; canonicalMarkdown: string | null }> {
  let canonical: string;
  try {
    canonical = await storageReadText(input.mdPath);
  } catch {
    throw new Error('TRANSCRIPT_MARKDOWN_UNAVAILABLE');
  }
  if (!canonical) {
    throw new Error('TRANSCRIPT_MARKDOWN_UNAVAILABLE');
  }
  return {
    markdown:
      input.correctionState === 'ACTIVE' && input.correctedMarkdown
        ? input.correctedMarkdown
        : canonical,
    canonicalMarkdown: input.correctionRevision > 0 ? canonical : null,
  };
}

export async function loadTranscriptSourceVersions(
  userId: string,
  transcript: { id: string; source: string },
) {
  if (transcript.source !== 'WEB' && transcript.source !== 'X') return [];
  return db.sourceContentVersion.findMany({
    where: { userId, transcriptId: transcript.id },
    orderBy: { version: 'desc' },
    take: 12,
    select: { version: true, checksum: true, collectedAt: true, metadata: true },
  });
}
