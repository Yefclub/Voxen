# Versioned passage retrieval

Spec 230 adds a keyless, derived PostgreSQL read model alongside the existing
document search. It does not change canonical documents, provider execution or
the existing MCP search/read contracts.

## Integrity and maintenance

The index stores literal windows of at most 4,000 UTF-16 units, at most 240 units
of overlap, and exact source offsets, lines, headings and available timestamps.
Windows never bridge provenance boundaries. Recorded capture spans distinguish
original captured text from generated/contextual prose. Missing or invalid
capture provenance is explicitly unclassified source-derived context. Curated
notes and accepted external research retain distinct source types.
Timestamp carry-forward is confined to the same provenance region; a generated
description cannot assign a time anchor to an untimed original passage.

Canonical source triggers advance only affected generations. Search joins the
current owner, visibility and accepted-context state before applying its result
limit. A changed generation disappears immediately, even while its old derived
rows await replacement. Deletion removes the derived ledger and passages;
source content is never deleted by indexing.

Workers use two-minute leases, three bounded attempts per generation, frozen
source revisions and atomic passage/receipt publication. A replacement lease or
source edit fences an earlier worker. Canonical rows are locked before the
derived ledger, matching the source-write order. Object reads happen outside
publication transactions. Backfill discovers at most 50 missing sources per
batch by default and persists every accepted source independently of process
memory. Failed or missing indexes retain canonical reads and explicit lexical
fallback results.

Maintenance runs every five seconds, backfills at most 50 missing ledgers and
selects at most 16 due sources per tick, with four executions at a time. Object
reads have a 30-second deadline, a 16 MB byte ceiling and the 4,000,000-unit
text ceiling; malformed UTF-8 is rejected without replacement text. Local and
S3 streams receive cancellation, and a stalled header/body cannot hold the
drain indefinitely.

A passage reference contains its key, source identity, revision and document/
passage checksums. Reading it checks the current canonical text and revision;
an old search result is not itself verification. Original/source-derived/
accepted-external labels describe provenance, not factual truth.

`voxen_search_passages` and `voxen_read_passage` are additive READ-scoped MCP
tools. Chat uses the same query/verification services through its existing
lease and tool-call budgets. Search references remain unverified until a
canonical read succeeds. Existing public MCP schemas, filters and progressive
reading contracts are retained. One regression kills a real claimed worker
with SIGKILL and recovers it in a fresh process; the test advances its stored
lease expiry explicitly and does not assert real-time timer accuracy.

## PostgreSQL strategy

Passage and title vectors are maintained by SQL triggers using the built-in
simple, Portuguese and English configurations. Existing Portuguese FTS indexes
remain intact. Body and title candidates are selected separately so title
matching does not force every body through an unindexed OR condition.

The bundled `pg_trgm` module supports bounded title/entity name discovery only.
Queries use a transaction-local strict-word threshold of 0.4, a 1.5-second SQL
timeout, at most five leads, and owner/source visibility before the limit.
Short, numeric-only or punctuation-bearing identifiers do not use this path.
Similarity never verifies a quote or merges identities. Exact identifier reads
retain punctuation, including the distinction between `C++` and `C#`.

PostgreSQL's [permissive license](https://www.postgresql.org/about/licence/),
[FTS controls](https://www.postgresql.org/docs/17/textsearch-controls.html),
[FTS limits](https://www.postgresql.org/docs/17/textsearch-limitations.html) and
[pg_trgm documentation](https://www.postgresql.org/docs/17/pgtrgm.html) informed
this choice. No additional database image, model, embedding service or search
cluster is required.

## Isolated evaluation — 2026-11-14

The production query functions were evaluated on PostgreSQL 17.11 and Bun 1.4.4,
on an Intel i5-4590S with four exposed cores. The synthetic corpus contained
489 owned sources (including one archived control), 60 foreign controls,
717 indexed passages and 1,852,147 source bytes. It covered Portuguese/English,
literal IDs, long-source middle facts, accepted external context and misspelled
titles/entities. No production content or provider calls were used.

One warm-up round was excluded; three rounds alternated baseline/candidate
query order. Canonical citation checks were outside timed search. Thirty-four
document queries and four entity queries used existing Portuguese FTS and graph
search as their respective baselines.

| Measurement | Existing baseline | Passage candidate |
| --- | ---: | ---: |
| Expected document discovered | 22/34 | 34/34 |
| Complete fixture quotation in returned excerpt | 4/30 | 30/30 |
| Misspelled entity discovered | 0/4 | 4/4 |
| Canonical versioned passage citations checked | Not supplied by baseline | 30/30 valid |
| Warm p50 search | 1.16 ms | 31.87 ms |
| Warm p95 search | 24.27 ms | 40.84 ms |

Complete-quotation recall is stricter than headline relevance: baseline snippets
retain their existing short word limit, while candidate excerpts allow up to
1,200 UTF-16 units. This metric does not imply that a shorter baseline headline
is incorrect. Similar-name leads count only toward discovery, never passage
recall or citation verification. These deterministic samples do not establish
general semantic accuracy or performance on larger libraries.

Initial indexing took 2.75 seconds, excluding corpus creation. Derived ledger
and passage relations occupied 3,211,264 bytes including their indexes and
TOAST, plus 8,192 bytes for the entity-name index. Existing note/transcript FTS
indexes occupied 204,800 bytes. Index size is reported as additional storage,
not a claim of reduced storage cost. This candidate passes the predeclared
quality/isolation and 250 ms p95 gate; it offers richer retrieval at an observed
latency/storage cost while retaining baseline discovery.

This run was recorded at 2026-11-14T21:30:14Z with default GiST signatures.
Custom signature options were removed in a forward migration after a repeated
Prisma shadow reset rejected their introspection. Normal upgrade/declarative
drift checks pass without changing the migration gate or its existing allowlist.

The opt-in benchmark lives in `apps/web/tests/passage-benchmark.test.ts`. It
requires a dedicated local database named `voxen_passage_benchmark` (or an
underscore-suffixed variant), applies the normal migrations before execution,
creates only synthetic workspaces and removes those workspaces afterward.
Run from `apps/web` after checking the Makefile's Bun test entry point:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/voxen_passage_benchmark \
  STORAGE_DRIVER=local STORAGE_LOCAL_PATH=/tmp/voxen-passage-benchmark-storage \
  PASSAGE_BENCHMARK=1 PASSAGE_BENCHMARK_REPORT=/tmp/voxen-passage-benchmark.json \
  bun --no-env-file test tests/passage-benchmark.test.ts
```

The JSON report includes per-query observations, relation sizes and a measured
representative query plan. Ordinary test runs skip this opt-in measurement;
the deterministic integrity, ownership, lifecycle and recovery tests still run.
