// ============================================================================
// Bounded reuse of expensive READ results (spec 217 §2, issue #898).
// ============================================================================
// Page 2+ of a ranked search can be served from the prepared result instead
// of repeating the full search and materialization — within explicit bounds:
//
// - Binding: the signed cursor already HMAC-binds owner, tool, and normalized
//   args; reuse additionally checks the stored owner/tool and the content
//   digest, so cross-owner or altered-argument continuations fail closed.
// - Freshness: every cached row carries a version (transcript correction +
//   source version, note revision). Before serving, versions are re-read;
//   any missing, inaccessible, or changed row produces MCP_CONTENT_CHANGED
//   with restart guidance — never stale content. The digest alone is not
//   trusted, because identical bytes cannot prove continued access.
// - Bounds: TTL, entry/byte caps with LRU eviction, per-entry size cap.
//   A miss (absent/expired/evicted entry, non-reusable tool) transparently
//   falls back to the recompute path. No database transaction is held.
// - Scope: only the three ranked search tools, whose items carry stable
//   (sourceType, id) identity. Anything else (including external-enrichment
//   rows, which lack a cheap version check) recomputes as before.
//
// Single-process memory; the MCP server runs in one Bun process per
// deployment. No unbounded snapshot is ever retained.
// ============================================================================

import { db } from '../lib/db';
import {
  McpResultBudgetError,
  resultDigest,
  verifyResultCursor,
  type McpResultContext,
} from './mcp-content-cursor';
import { sliceSerializedResult } from './mcp-result-budget';

export type ReuseStats = {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  entries: number;
  bytes: number;
};

type VersionMap = Map<string, string>;

type ReuseEntry = {
  owner: string;
  tool: string;
  serialized: string;
  bytes: number;
  createdAt: number;
  versions: Array<[string, string]>;
};

const entries = new Map<string, ReuseEntry>();
let bytesTotal = 0;
const stats = { hits: 0, misses: 0, stores: 0, evictions: 0 };

let maxEntries = 100;
let maxBytes = 4 * 1024 * 1024;
let maxEntryBytes = 256 * 1024;
let ttlMs = 5 * 60 * 1000;

/** Test-only tuning (isolates bound/eviction/TTL assertions between cases). */
export function configureResultReuseForTests(overrides: {
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  ttlMs?: number;
}): void {
  if (overrides.maxEntries !== undefined) maxEntries = overrides.maxEntries;
  if (overrides.maxBytes !== undefined) maxBytes = overrides.maxBytes;
  if (overrides.maxEntryBytes !== undefined) maxEntryBytes = overrides.maxEntryBytes;
  if (overrides.ttlMs !== undefined) ttlMs = overrides.ttlMs;
}

export function getResultReuseStats(): ReuseStats {
  return {
    hits: stats.hits,
    misses: stats.misses,
    stores: stats.stores,
    evictions: stats.evictions,
    entries: entries.size,
    bytes: bytesTotal,
  };
}

/** Test-only reset (isolates cache assertions between cases). */
export function clearResultReuseCache(): void {
  entries.clear();
  bytesTotal = 0;
  stats.hits = 0;
  stats.misses = 0;
  stats.stores = 0;
  stats.evictions = 0;
}

type ItemRef = { kind: 'transcript' | 'note'; id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractIds(
  structured: unknown,
  defaultKind: 'transcript' | 'note' | 'mixed',
): ItemRef[] | null {
  if (!isRecord(structured) || !Array.isArray(structured.results)) return null;
  const refs: ItemRef[] = [];
  for (const item of structured.results) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) return null;
    if (defaultKind === 'mixed') {
      if (item.sourceType === 'transcript') refs.push({ kind: 'transcript', id: item.id });
      else if (item.sourceType === 'note') refs.push({ kind: 'note', id: item.id });
      else return null;
    } else {
      refs.push({ kind: defaultKind, id: item.id });
    }
  }
  return refs;
}

const REUSABLE_TOOLS: Record<string, 'transcript' | 'note' | 'mixed'> = {
  voxen_search_knowledge: 'mixed',
  voxen_search_transcripts: 'transcript',
  voxen_search_notes: 'note',
};

async function snapshotVersions(userId: string, refs: ItemRef[]): Promise<VersionMap | null> {
  const versions: VersionMap = new Map();
  const transcriptIds = [
    ...new Set(refs.filter((ref) => ref.kind === 'transcript').map((ref) => ref.id)),
  ];
  const noteIds = [...new Set(refs.filter((ref) => ref.kind === 'note').map((ref) => ref.id))];
  if (transcriptIds.length > 0) {
    const rows = await db.transcript.findMany({
      where: { id: { in: transcriptIds }, userId },
      select: { id: true, status: true, correctionRevision: true, sourceVersion: true },
    });
    if (rows.length !== transcriptIds.length) return null;
    for (const row of rows) {
      if (row.status !== 'ACTIVE') return null;
      versions.set(`transcript:${row.id}`, `${row.correctionRevision}:${row.sourceVersion}`);
    }
  }
  if (noteIds.length > 0) {
    const rows = await db.note.findMany({
      where: { id: { in: noteIds }, userId },
      select: { id: true, kind: true, revision: true },
    });
    if (rows.length !== noteIds.length) return null;
    for (const row of rows) {
      if (row.kind !== 'NOTE') return null;
      versions.set(`note:${row.id}`, `${row.revision}`);
    }
  }
  return versions;
}

function evictIfNeeded(): void {
  while ((entries.size > maxEntries || bytesTotal > maxBytes) && entries.size > 0) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    const evicted = entries.get(oldest.value);
    entries.delete(oldest.value);
    if (evicted) bytesTotal -= evicted.bytes;
    stats.evictions += 1;
  }
}

/** Store a fresh result for later pages. Best-effort: oversized or versionless results are skipped. */
export async function storeReusableResult(
  context: McpResultContext,
  normalized: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  const mode = REUSABLE_TOOLS[context.tool];
  if (!mode) return;
  const refs = extractIds(normalized, mode);
  if (refs === null) return;
  const serialized = JSON.stringify(normalized);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxEntryBytes) return;
  let versions: VersionMap | null;
  try {
    versions = await snapshotVersions(context.userId, refs);
  } catch {
    return;
  }
  if (versions === null) return;
  const digest = resultDigest(serialized);
  const existing = entries.get(digest);
  if (existing) {
    bytesTotal -= existing.bytes;
    entries.delete(digest);
  }
  entries.set(digest, {
    owner: context.userId,
    tool: context.tool,
    serialized,
    bytes,
    createdAt: now,
    versions: [...versions],
  });
  bytesTotal += bytes;
  stats.stores += 1;
  evictIfNeeded();
}

/**
 * Serve a continuation page from the prepared result. Returns null on any
 * miss (unknown/expired/evicted entry, non-reusable tool) so the caller
 * falls back to the recompute path. Throws McpResultBudgetError on
 * binding or freshness violations, exactly like a divergent recompute would.
 */
export async function serveReusedResult(
  context: McpResultContext,
  now = Date.now(),
): Promise<Record<string, unknown> | null> {
  const mode = REUSABLE_TOOLS[context.tool];
  if (!mode || !context.cursor) return null;
  const verified = verifyResultCursor(context, now);
  const entry = entries.get(verified.digest);
  if (!entry) {
    stats.misses += 1;
    return null;
  }
  if (entry.owner !== context.userId || entry.tool !== context.tool) {
    stats.misses += 1;
    return null;
  }
  if (entry.createdAt + ttlMs <= now) {
    entries.delete(verified.digest);
    bytesTotal -= entry.bytes;
    stats.misses += 1;
    return null;
  }
  let current: VersionMap | null;
  try {
    current = await snapshotVersions(
      context.userId,
      entry.versions.map(([key]) => {
        const separator = key.indexOf(':');
        return {
          kind: key.slice(0, separator) as 'transcript' | 'note',
          id: key.slice(separator + 1),
        };
      }),
    );
  } catch {
    throw new McpResultBudgetError('MCP_CONTENT_CHANGED');
  }
  if (current === null || current.size !== entry.versions.length) {
    throw new McpResultBudgetError('MCP_CONTENT_CHANGED');
  }
  for (const [key, version] of entry.versions) {
    if (current.get(key) !== version) throw new McpResultBudgetError('MCP_CONTENT_CHANGED');
  }
  // Refresh recency without extending the freshness window.
  entries.delete(verified.digest);
  entries.set(verified.digest, entry);
  stats.hits += 1;
  return sliceSerializedResult(entry.serialized, verified.digest, verified.offset, context, now);
}
