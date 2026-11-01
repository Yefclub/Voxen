# Spec 216 — Prepared-content ingestion, retrieval, and MCP (Product 1)

## Context

Product 1 is a self-hosted base where prepared content is injected, preserved, and retrieved fast and precisely over MCP. Baseline `dev` at `95524cf`. Companion spec 215 removes built-in AI; this spec must not reintroduce model execution to meet retrieval needs.

## Glossary

- Prepared document: versioned payload with producer identity, external ID, idempotency key, sections/blocks, assets, provenance.
- Passage: document/block location with source/revision and retrieval origin.
- Stored values: summaries, tags, entities, relations supplied by producers, kept as knowledge.

## Requirements

### Ubiquitous

- The system shall expose a versioned prepared-content contract usable over HTTP and MCP with schema version, producer identity, external document identity, workspace-scoped idempotency.
- The system shall support source/type, title, language, author, publication dates, full text/Markdown, structured sections/blocks with stable IDs, page/line/time bounds, asset refs, checksums, supplied summaries/tags/entities/relations/provenance/coverage.
- The system shall preserve existing IDs, source URLs, revisions, note anchors, tags/folders, accepted derived material, stored assets through forward migrations.
- The system shall keep source content distinguishable from producer-supplied interpretation.
- The system shall order search results deterministically under owner/status isolation.

### Event-driven

- When a producer retries with the same idempotency key, the system shall return the original document/revision without creating a duplicate.
- When a producer submits an update with the expected revision, the system shall apply it, preserve history, and invalidate affected anchors/index versions.
- When a batch import runs, the system shall return per-item outcomes and stay within MCP request budgets with a documented large-payload path.
- When a search runs, the system shall return passages with document/block identity, exact location, source/revision, and retrieval origin.
- When a narrow read repeats, the system shall use a bounded indexed/version-aware strategy instead of always loading full canonical content.
- When canonical content is missing, the system shall report not-found, unavailable source, stale revision/cursor, or indexing pending explicitly.

### State-driven

- While search filters are supported, source/type, language, dates, tags/collection, and document filters shall be available and validated.
- While graph/evidence navigation exists, imported/manual relations with source anchors and provenance shall be preserved.

### Optional

- Where `pg_trgm` improves prefix/phrase/typo handling, the system shall enable it behind measured retrieval tests.

### Unwanted behavior

- If a prepared payload carries only a source URL without content, then the system shall treat the URL as metadata and never auto-fetch, transcribe, or analyze it.
- If an update supplies a stale expected revision, then the system shall reject it without creating a new revision.
- If a write exceeds MCP budgets, then the system shall reject with an explicit budget error and point to the bulk path.
- If no evidence supports a claim, then the system shall report no-evidence instead of synthesizing an answer.

## Acceptance criteria

- [ ] Producer can create/read/update/batch-import prepared content with no provider credentials, capture, or analysis.
- [ ] Idempotent retries and concurrent updates preserve one identity and reject stale overwrites; import/index readiness observable.
- [ ] Generic documents, passages, assets, provenance, revisions representable without fake transcription fields; upgrade preserves library.
- [ ] Search supports agreed filters and returns source-backed passage locations with deterministic ordering and isolation.
- [ ] Repeated narrow reads use bounded strategy; unavailable structure reported explicitly.
- [ ] Modern/legacy MCP behavior, budgets, signed cursors, revision safety covered or migrated.
- [ ] Export/import and backup/restore preserve content, refs, revisions, relations, assets.
- [ ] Reproducible Postgres/storage/MCP benchmark publishes quality/latency with baseline and regression thresholds.
- [ ] Library UI and MCP docs expose prepared-content workflows accurately.

## Out of scope

- Notes-only import as the full external contract.
- Mandatory vector DB or rewrite.
- Internal LLM rewriting or embedding inference.

## Risks / Open decisions

- `Transcript` requires platform/transcription fields; contract/schema evolution must avoid fake media values.
- `Chunk` exists but is unused; block indexing strategy TBD (populate vs version-aware cache).
- Current benchmark harness is mocked; real Postgres/storage harness needs separate gate from unit tests.
