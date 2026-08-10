# Spec 186 — Surgical, versioned note editing

## Context

Voxen notes can currently be replaced wholesale by the browser, chat tools, or
MCP without an optimistic concurrency token or durable history. A stale tab or
agent can silently overwrite a newer edit, and every mutation reindexes the
entire note collection. Agents also lack a bounded way to find an exact passage
inside one note before proposing a change.

This specification introduces immutable content revisions, exact surgical
operations, review-before-apply workflows, and source-scoped Brain refreshes.
Explicit transcript anchors, note hierarchy, wiki links, and manual graph
evidence remain authoritative and must not be discarded by an editorial change.

## Glossary

- **Revision**: immutable snapshot of a note title and markdown content after a
  successful mutation.
- **Expected revision**: the revision observed by a writer before it proposes or
  submits a mutation.
- **Surgical operation**: exact replace, insert-before, insert-after, prepend, or
  append applied to a bounded note body.
- **Graph sync**: source-specific Brain refresh for the edited note; a pending
  result is recoverable by the existing graph reconciliation loop.

## Requirements

### Ubiquitous

- The system shall maintain a monotonic revision number for every note and an
  immutable snapshot for every successful editorial state.
- The system shall scope note reads, searches, previews, revisions, restores,
  mutations, and graph refreshes to the authenticated user.
- Every modifying HTTP, chat, and MCP path shall compare an expected revision
  before changing a note.
- Every revision shall record its actor surface, a bounded change summary, an
  opaque content checksum, and its creation time.
- Exact note-content search shall return bounded matches with offsets, line
  numbers, and surrounding context without returning another user's content.
- A note edit shall refresh only that note's automatic Brain materialization,
  invalidate the user's graph cache, and preserve manual graph edges and
  explicit transcript anchors unless the caller explicitly edits those links.

### Event-driven

- When a note is created, the system shall atomically persist revision 1 with
  the note.
- When a writer previews a surgical operation, the system shall return the
  proposed title/content checksum, a bounded diff, the current revision, and no
  persistent mutation.
- When a writer applies a valid operation against the current revision, the
  system shall atomically update the note, increment its revision exactly once,
  and append the corresponding immutable snapshot.
- When an exact target occurs more than once and no occurrence is supplied, the
  system shall reject the operation as ambiguous and report the match count.
- When a requested historical revision is restored, the system shall create a
  new head revision instead of deleting or rewriting history.
- When a browser save conflicts with a newer revision, the system shall retain
  the local draft, explain the conflict, and offer an explicit reload rather
  than overwriting either copy.
- When the chat proposes a note mutation, the system shall expose the bounded
  change for human confirmation and apply it only after approval.
- When graph write coordination is temporarily unavailable after a committed
  note edit, the system shall return a pending graph-sync state while preserving
  the committed revision for later reconciliation.

### State-driven

- While a note has unsaved browser changes, background revalidation shall not
  overwrite the local draft.
- While a chat edit awaits approval, it shall not be eligible for the
  always-allow preference used by note creation.
- While an MCP token is read-only, no note mutation or restore tool shall be
  exposed or executable.
- While a revision is historical, it shall never be updated in place.

### Unwanted behavior

- If the expected revision is stale, then the system shall return a conflict
  containing the current revision/checksum and perform no partial mutation.
- If an operation's target is absent, ambiguous, empty, or outside the content
  limit, then the system shall perform no mutation.
- If a note, revision, transcript source, or approval belongs to another user,
  then the system shall hide its existence and perform no graph write.
- If graph refresh fails after the database commit, then the system shall not
  roll back or falsely report that the note update failed.
- If an edit changes note content, then the system shall not delete manual graph
  relations or unrelated transcript anchors.

## Acceptance criteria

- [x] An idempotent migration backfills revision 1 for existing notes and adds
      immutable revision storage without losing content.
- [x] Domain tests cover exact replace, explicit occurrence, inserts,
      prepend/append, absent targets, ambiguity, bounds, and deterministic
      checksums/diffs.
- [x] Concurrent writes with the same expected revision result in one commit and
      one conflict, with no duplicate revision number.
- [x] HTTP endpoints support targeted search, preview/apply, revision history,
      restore, and conflict responses with user isolation.
- [x] Existing full note saves become versioned and concurrency-safe without
      dropping source links or anchors.
- [x] MCP exposes revision-aware read/search, surgical edit, history, restore,
      and a compatibility-safe full update contract.
- [x] Chat can search inside a note and propose a surgical edit that requires
      human approval; stale approval cannot overwrite a newer revision.
- [x] The notes UI shows the current revision, preserves drafts on conflict, and
      can inspect and restore history in PT-BR and English.
- [x] Tests prove a successful edit refreshes only its source note, preserves
      manual evidence, and reports pending when the graph lease is unavailable.
- [x] Playwright covers a browser conflict and historical restore.
- [x] Format, lint, typecheck, full tests, migration gate, quality gate, and
      production build pass.

## Out of scope

- Direct edits to canonical transcript text; those require a separate reviewed
  correction model so original evidence remains immutable.
- Rich collaborative cursors or operational-transform/CRDT editing.
- Semantic multilingual search changes; those are a later roadmap increment.
- Interactive Mermaid zoom/fullscreen; that is a separate UI increment.

## Rollout and rollback

- The schema change is additive. Existing notes are assigned revision 1 and a
  bootstrap snapshot during migration.
- Existing personal MCP tokens remain valid; write tools gain optimistic
  concurrency rather than a new authorization scope.
- Rollback may stop exposing mutation/history endpoints while retaining revision
  rows. The new history data must not be dropped during an application rollback.

> 2026-08-10: approved as the third implementation increment of the owner-approved
> graph reliability, surgical editing, Mermaid interaction, and bilingual search
> roadmap.
