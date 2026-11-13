# Spec 230 — Versioned passage retrieval

## Context

The owner authorized more efficient indexing and retrieval on 2026-11-13. The
existing PostgreSQL full-text and graph retrieval remain the baseline. New
retrieval must improve evidence selection without requiring provider keys.

## Requirements

### Ubiquitous

- The system shall index bounded passages with owner, source identity, revision,
  checksum, section and available line/time anchors.
- The system shall distinguish original text, source-derived context and accepted
  external enrichment in search results and citations.
- The system shall preserve exact identifiers, handle Portuguese/English source
  text and support bounded typo-tolerant title/entity discovery.
- The system shall maintain deterministic ordering and enforce owner and source
  visibility before returning candidates.

### Event-driven

- When content changes, the system shall refresh only affected passage indexes
  and shall prevent an older indexing pass from replacing newer content.
- When content becomes inaccessible, the system shall remove its passages from
  retrieval before asynchronous cleanup completes.
- When a passage matches, the system shall return a bounded excerpt and a stable
  source reference that can be checked against the current source revision.
- When deploying to an existing library, the system shall backfill missing
  indexes incrementally without making knowledge-base reads depend on AI.

### State-driven

- While candidate strategies are evaluated, the system shall compare relevant
  source/passage recall, citation validity, latency and index cost with the
  existing full-text baseline using an isolated representative corpus.

### Unwanted behavior

- If a derived index is stale or unavailable, then the system shall preserve
  canonical document retrieval and report the limitation without inventing evidence.
- If an optimization fails quality, isolation or recovery checks, then the
  system shall retain the baseline rather than enabling it by default.

## Acceptance criteria

- [ ] Passages and accepted external context have maintained text indexes.
- [ ] Search returns matching passages with section/line/time provenance.
- [ ] Typo, mixed-language, exact-ID and long-source cases are covered.
- [ ] Updates, corrections, archival and deletion cannot return stale evidence.
- [ ] Backfill, incremental indexing and restart recovery are tested.
- [ ] A measured PostgreSQL benchmark compares candidate retrieval to baseline.

## Out of scope

Mandatory external search clusters, local inference, embeddings, automatic
adoption of a database extension without validation and changing canonical
document or existing public MCP contracts.
