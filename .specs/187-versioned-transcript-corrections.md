# Spec 187 — Versioned transcript corrections

## Context

Transcripts are evidence captured from an external source. Fixing a recognition
error or adding a narrowly scoped clarification must not overwrite that evidence
or silently move graph anchors. Voxen therefore needs a reviewable correction
layer that can be edited through the browser, chat, and MCP while the original
Markdown, source snapshots, and uploaded media remain immutable.

## Definitions

- **Canonical source**: the original Markdown and `plainText` produced for the
  current `sourceVersion`.
- **Correction head**: the latest materialized corrected Markdown/plain text for
  a transcript. Revision `0` means that no correction has been committed.
- **Effective content**: the active correction head when it still targets the
  current source version/checksum; otherwise the canonical source.
- **Surgical operation**: exact replace, insert-before, insert-after, prepend, or
  append against the effective Markdown.

## Requirements

### Ubiquitous

- The canonical source object, `mdPath`, `plainText`, source snapshots, and media
  shall never be overwritten by a correction.
- Every read, search, preview, apply, revision, restore, graph refresh, and MCP
  operation shall be scoped by `userId`.
- Every mutation shall require the expected correction revision and the current
  source version/checksum.
- Every committed correction shall create an immutable full snapshot with its
  actor, bounded summary, operation metadata, resulting checksum, and source
  identity.
- Search and derived graph compilation shall use effective content while keeping
  provenance attached to the original transcript and the correction revision.
- Manual graph relations and note anchors shall not be deleted or moved by a
  correction refresh.

### Event-driven

- When a writer previews a surgical operation, the system shall return exact
  match counts, a bounded before/after context, the expected source identity,
  and the resulting checksum without changing state.
- When a writer applies a valid preview against the current source and correction
  revision, the system shall atomically advance the correction revision once,
  persist the snapshot, update effective search content, and enqueue/reconcile
  graph derivatives for that transcript.
- When two writers apply against the same revision, exactly one shall commit and
  the other shall receive the current revision/checksum without partial writes.
- When a historical correction is restored, the system shall create a new head
  revision instead of deleting or rewriting history.
- When a WEB refresh changes `sourceVersion` or `sourceChecksum`, the system shall
  mark the correction head stale in the same transaction and immediately fall
  back to canonical content for search and retrieval.
- When the user explicitly resets corrections, the system shall create a new
  revision whose effective content equals the canonical source.

### State-driven

- While a correction head is `ACTIVE`, browser reads, FTS snippets, AI retrieval,
  MCP reads, summaries requested after the correction, and graph compilation
  shall consume corrected content.
- While a correction head is `STALE`, the UI and APIs shall expose the stale
  reason and retain its immutable history, but default retrieval shall consume
  the current canonical source.
- While an MCP credential lacks `mcp:write`, no correction or restore tool shall
  be registered.

### Unwanted behavior

- If the exact target is missing or ambiguous and no occurrence is selected,
  then no mutation shall occur.
- If the expected correction revision, source version, source checksum, or
  preview checksum is stale, then no mutation shall occur.
- If a transcript belongs to another user, the endpoint or tool shall hide its
  existence.
- If graph synchronization is temporarily unavailable, the content commit shall
  remain durable and report a pending graph state for reconciliation.
- A correction shall never be presented as a change to the external source.

## Acceptance criteria

- [x] An idempotent migration adds correction head state, immutable snapshots,
      effective FTS, ownership indexes, and cascade cleanup.
- [x] Unit and integration tests prove source immutability, exact patches,
      optimistic concurrency, source-refresh staleness, user isolation, reset,
      history pagination, and restore.
- [x] Transcript HTTP APIs expose search-in-content, preview/apply, revision
      history, restore, and reset with structured conflict responses.
- [x] MCP exposes revision-aware transcript reads/search and correction tools,
      respecting read/write scopes and backward-compatible personal tokens.
- [x] Chat proposes corrections with a server-generated preview and requires
      explicit approval before the transaction revalidates and commits them.
- [x] The transcript page distinguishes original/effective content, shows the
      correction revision/stale state, preserves drafts on conflict, and can
      inspect/restore history in PT-BR and English.
- [x] FTS, summary/tag inputs, chat retrieval, and grounded graph compilation use
      effective content; correction commits do not delete manual graph evidence.
- [x] Playwright covers a correction conflict and historical restore.

## Out of scope

- Editing audio/video files or changing the canonical external-source snapshot.
- Automatically accepting an AI-proposed correction without user confirmation.
- Re-aligning timestamps after arbitrary large rewrites; corrections preserve
  existing timestamp markers and flag anchors whose selected quote no longer
  appears for later review.

## Rollout and rollback

- The schema is additive and existing transcripts remain at correction revision
  `0`, so effective content is identical to canonical content after migration.
- Rollback may stop exposing correction endpoints while retaining snapshots. It
  must restore the FTS trigger to canonical `plainText` before dropping any head
  columns.
