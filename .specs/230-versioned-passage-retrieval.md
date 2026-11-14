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

- [x] Passages and accepted external context have maintained text indexes.
- [x] Search returns matching passages with section/line/time provenance.
- [x] Typo, mixed-language, exact-ID and long-source cases are covered.
- [x] Updates, corrections, archival and deletion cannot return stale evidence.
- [x] Backfill, incremental indexing and restart recovery are tested.
- [x] A measured PostgreSQL benchmark compares candidate retrieval to baseline.

Local acceptance evidence is recorded in `docs/PASSAGE-RETRIEVAL.md` and the
passage/MCP/assistant test suites. Recovery includes an actual worker SIGKILL
and a fresh process, with explicit test-only lease expiry rather than a claim
about two-minute wall-clock accuracy. Independent final review, remote CI and
deployment remain delivery gates.

## Passage integrity and delivery bounds

- The system shall preserve exact source text and Unicode boundaries in each
  passage, including individual lines longer than the passage window.
- The system shall use passages of at most 4,000 UTF-16 units, with at most 240
  units of overlap, and shall never overlap across provenance boundaries.
- The system shall accept at most 4,000,000 UTF-16 source units and 4,096
  passages or section markers per source. If this capacity is exceeded, then
  indexing shall fail explicitly before publication and retain baseline reads.
- The system shall derive passage identities deterministically from the owner,
  source, revision, provenance and exact text, so retries cannot duplicate them.
- The system shall obtain provenance from recorded source spans rather than
  heading names. Captured text without a valid provenance record shall not be
  classified as original captured evidence.
- Where source text is a curated note, the system shall identify the note as
  its original document, without assigning captured-media authority.
- The system shall retain all existing public MCP tool schemas, output shapes,
  filters, limits and continuation semantics. Passage-specific reads shall be
  additive and read-only.

## Evaluation gate

- While evaluating the candidate, the system shall use an isolated synthetic
  corpus of at least 400 owned sources, plus foreign and inaccessible controls,
  with Portuguese, English, literal identifiers, long-source middle facts,
  accepted external context and misspelled names.
- The system shall report source recall, literal-passage recall, verified
  citation validity, warm p50/p95 latency, indexing time and index/storage bytes
  for both strategies where those measurements apply.
- If candidate source or passage recall is below baseline, any candidate
  citation fails canonical validation, or any inaccessible control is returned,
  then the system shall not activate the candidate.
- If candidate warm p95 exceeds 250 ms on the recorded evaluation host, then
  the system shall retain the baseline as the default strategy.
- The system shall distinguish typo discovery leads from matching passages and
  shall never count a name-similarity score as verified passage evidence.

> 2026-11-14: Clarified bounded passage integrity and compatibility for the
> owner-authorized implementation; PostgreSQL extensions remain subject to the
> isolated compatibility and retrieval benchmark before adoption.

## Out of scope

Mandatory external search clusters, local inference, embeddings, automatic
adoption of a database extension without validation and changing canonical
document or existing public MCP contracts.
