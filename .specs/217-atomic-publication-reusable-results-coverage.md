# Spec 217 — Atomic publication, reusable search results, and explicit coverage

## Context

Product 1 keeps prepared knowledge usable during updates and lets MCP clients
traverse large result sets with an explicit account of what each operation
covered. Baseline `dev` at `6b2026a`. Companion work (specs 215/216) already
delivered: versioned prepared-content contract with workspace idempotency,
validated search filters with deterministic ordering, bounded version-aware
reads with explicit failure states, backup/restore preservation checks, and a
real PostgreSQL/storage/MCP benchmark.

Verified foundations on current `dev` (not missing features to rebuild):

- Note/transcript writes are transactional in PostgreSQL; full-text vectors
  update through triggers in the same write path.
- Derived projections are intentionally deferred: note graph sync is
  best-effort with a `READY`/`PENDING` state (`note-versioning.ts`
  `syncNoteGraph`); transcript grounded compilation is deferred with source
  invalidation (`transcript-correction-versioning.ts`
  `deferGroundedCompilation`); narrow reads carry a version-aware bounded
  cache invalidated on commit.
- READ continuation exists: `content_cursor` is HMAC-bound to owner, tool,
  and normalized arguments, digest-checked against the regenerated result
  (`MCP_CONTENT_CHANGED`), and expires after 5 minutes
  (`mcp-content-cursor.ts`). Oversized results are sliced from the
  serialized result with restart guidance, never silently truncated
  (`mcp-result-budget.ts`). The tool callback re-runs on every page
  (`mcp-tool-execution.ts`).
- List traversal exists: opaque page cursors bound to owner/tool with
  keyset boundaries and `nextCursor` (`mcp-page-cursor.ts`,
  `mcp-transcript-discovery-tools.ts`).
- Retrieval is lexical (`ts_rank` over `searchVector`, no field weighting),
  deterministic (score desc, identity asc), owner/status-scoped
  (`search.ts`, `search-filters.ts`).

## Glossary

- Published revision: the revision clients may read and cite.
- Candidate generation: content, assets, index rows, locations, and discovery
  metadata being prepared for one document update, not yet published.
- Index generation: version of the derived structures (blocks, locations,
  cards, weights) compatible with one published revision.
- Coverage: the execution account of one operation over its specified
  set/query — scope, snapshot/revision, completion state, interruption
  reason. Never presented as proof of semantic recall or truth.
- Discovery card: compact projection (description, topics, identifiers,
  outline, producer-supplied questions) derived deterministically from
  prepared metadata. A navigation aid, not evidence.

## Requirements

### Ubiquitous

- The system shall publish a document update only when content, assets,
  index rows, locations, and discovery metadata belong to one compatible
  generation; a failed or cancelled candidate shall never replace the last
  permitted published revision.
- The system shall track source revision and indexing/representation version
  separately, so unchanged bytes never justify reusing incompatible derived
  structures.
- The system shall keep deterministic rebuilds idempotent and restartable,
  revalidating document state (existence, status, access) before publishing
  so a finishing job cannot resurrect removed knowledge or undo archival.
- The system shall keep interrupted work and orphaned candidate artifacts
  eligible for bounded maintenance without placing repair/rebuild work in
  synchronous reads.
- The system shall report counts as known, estimated, or unknown and never
  force an expensive global count for an ordinary search.
- The system shall keep index-only structural context separate from the
  literal passage, its stable identity, and its page/line/time locations.
- The system shall accept generated context or questions only from external
  producers through the prepared-content contract; indexing stays
  deterministic with no model execution.

### Event-driven

- When a candidate generation finishes, the system shall revalidate source
  state and publish by switching the stored reference inside a database
  transaction; stored content/assets shall be immutable before the switch,
  without assuming filesystem/S3 participation in the transaction.
- When publication is impossible (deleted, archived, inaccessible, or
  incompatible derived structures), the system shall keep the last
  permitted revision and report the revision/state explicitly.
- When a client continues an expensive or oversized read, the system shall
  reuse the prepared result within documented TTL/entry/byte limits instead
  of repeating the full search and materialization on every page, while
  preserving ordering and reporting expiry or change explicitly.
- When continuation arguments, scope, owner, or relevant revisions change,
  the system shall reject the continuation with restart guidance, never
  serve cached content across the change.
- When cached content would expose deleted or newly inaccessible material,
  the system shall revalidate access and source availability before serving
  the page and report the change explicitly.
- When a search completes, the system shall return passages with
  document/block identity, exact location, source/revision, retrieval
  origin, and the coverage of that execution.
- When execution is incomplete (timeout, cancellation, unavailable source,
  indexing pending), the system shall distinguish it from a successfully
  completed empty result using explicit states.
- When backend work is cancelled or bounded, the system shall verify actual
  backend termination or bounding, not only HTTP race completion.

### State-driven

- While ranked search is available, the system shall keep it bounded with
  explicit truncation and continuation metadata.
- While a defined document/collection/filter set must be enumerated, the
  system shall provide a resumable traversal over the stable set with
  effective scope, relevant snapshot, completion state, and interruption
  reason, without duplicates or omissions while the snapshot holds.
- While discovery cards exist, the system shall derive the minimal card
  deterministically from title/metadata/structure when enrichment is
  absent, associate cards and supplied enrichment with producer/provenance
  and compatible revision, update only affected projections, and keep
  lookup bounded and owner-scoped. Missing or incomplete cards shall never
  exclude relevant original passages from direct search.
- While structural context is indexed, the system shall support bounded
  navigation to parent sections or neighboring blocks and preserve exact
  citations; explanatory metadata shall never silently become quoted source
  text.

### Optional

- Where representative questions show a retrieval benefit, the system shall
  extend title/heading/section weighting with full section context and
  record the measured quality delta with unchanged source text and citation
  locations.

### Unwanted behavior

- If an update would return a new search location against old text (or old
  locations against new text), then the system shall not publish it: until
  the candidate generation is ready, clients receive the last permitted
  revision or an explicit revision/state response.
- If concurrent update, deletion, archival, or access change overlaps a
  candidate, then the system shall not publish stale work or resurrect
  removed knowledge.
- If returning the ten best matches, then the system shall not imply that
  all procedures in a collection were enumerated.
- If a score, card, or enriched relation is presented, then the system shall
  not present it as a truth probability or original evidence; factual
  citations open the source passage.
- If a retrieval improvement requires model execution, embedding inference,
  generated rewriting, scraping, transcription, or a new search service,
  then the system shall reject that approach.

## Acceptance criteria

- [ ] A failed, cancelled, or restarted candidate update leaves the last
  permitted published revision usable; publication never mixes incompatible
  content, locations, indexes, and cards.
- [ ] Concurrent update, deletion, archival, and access-change cases cannot
  publish stale work or resurrect removed knowledge.
- [ ] Expensive-result continuation demonstrably reuses work within
  documented TTL/memory/byte limits, preserves ordering, and reports
  expiry/change explicitly.
- [ ] Cross-owner, altered-argument, expired-cursor, and deletion/access-
  change continuation cases pass without exposing cached content.
- [ ] Ranked search and complete enumeration have documented, bounded
  contracts with honest scope, continuation, counts, and completion states.
- [ ] Enumeration traverses the defined stable set without duplicates or
  omissions; incompatible changes produce the documented invalidation
  behavior.
- [ ] Catalog discovery works with minimal metadata and no model
  credentials; tests include a relevant detail absent from a card and a
  document without enrichment.
- [ ] Structural context improves or preserves agreed retrieval-quality
  thresholds while source text and citation locations remain unchanged.
- [ ] Timeout/cancellation tests verify backend work is cancelled or
  bounded, and distinguish incomplete execution from a successful empty
  result.
- [ ] The real benchmark reports baseline/candidate quality, end-to-end and
  per-stage latency, continuation work, and resource usage under documented
  conditions. Targets/regression thresholds are fixed before tuning; no
  unmeasured speed claim is used for acceptance.
- [ ] Permanent regression tests cover publication/restart races, isolation,
  continuation, coverage, and source-backed evidence. One-off evaluation
  artifacts are reproducible and referenced without adding evaluation
  workloads to the production image.
- [ ] Existing library data/IDs, HTTP/MCP clients, modern/legacy protocol
  behavior, export/restore guarantees, and response protections remain
  covered or receive an explicit migration.
- [ ] MCP guidance and existing UI surfaces explain partial/unavailable/
  pending/changed states consistently. Scores and indexed enrichment are
  not presented as truth probabilities or original evidence.

## Delivery

Focused PRs against `dev`, reusing the repository workflow (independent
review, green CI, squash merge):

1. Atomic publication and compatible generations (candidate staging,
   revalidation, idempotent rebuild, bounded orphan maintenance).
2. Reusable continuation and the ranked-search/enumeration coverage
   contract (bounded result reuse, invalidation behavior, documented
   migration of the continuation contract).
3. Discovery catalog and structural-context refinements supported by
   retrieval evaluation (deterministic cards, indexed context, measured
   quality deltas).

Integrate work bounds, observability, and regression validation with each
increment. Preserve behavior already delivered on `dev`.

## Out of scope

Built-in LLM execution, embedding inference, generated-query rewriting,
scraping, transcription, OCR, media analysis, Product 2 rebuild, mandatory
vector databases, additional search services, universal agent frameworks,
runtime/database rewrites, corporate publishing, billing, chat/history
products, voice/STS integration, and findings from other applications
presented as proven Voxen defects or guarantees.
