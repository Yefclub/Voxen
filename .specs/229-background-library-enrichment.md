# Spec 229 — Background library organization and grounded enrichment

## Context

The owner authorized automatic library organization and selective external
research on 2026-11-13. Source capture must remain useful immediately; research
is a separate derived activity. This restores generation with the provenance
and freshness principles retained from spec 175.

## Requirements

### Ubiquitous

- The system shall preserve the original source, user corrections and source
  summary when organizing or adding external context.
- The system shall bind every derived result to its owner, source revision,
  checksum, generation settings, citations, model and usage.
- The system shall distinguish automatic organization, external research and
  manually curated information.

### Event-driven

- When capture publishes a document, the system shall enqueue enabled derived
  work independently of capture completion.
- When recovering automatic research after interruption, the system shall
  schedule only captures collected since the current automatic consent began,
  including refreshed documents, without duplicating a source revision.
- When organizing, the system shall reuse existing topic and entity identities,
  add supported relationships and preserve manually selected organization.
- When research is enabled, the system shall determine whether additional
  information would help and shall record either cited context or a reason no
  research was needed.
- When researching, the system shall prefer primary sources and preserve
  verified excerpts, URLs and retrieval dates for external claims.
- When a source changes, expires, becomes inactive or is deleted, the system
  shall invalidate affected external context and search/graph projections.
- When the user reviews external context, the system shall support accepting,
  dismissing, deleting and requesting refreshed research.
- When editing or reviewing external context, the system shall reject obsolete
  revision/checksum guards and identify edited context as manually curated,
  requiring renewed acceptance without altering original evidence records.
- When accepting refreshed context, the system shall supersede previously
  accepted context for that document in the same transaction.

### State-driven

- While research is pending or fails, the source document shall remain usable.
- While external context is suggested, the interface shall identify it as such
  and exclude it from default factual retrieval until accepted.
- While processing long sources, the system shall analyze bounded sections and
  synthesize their grounded findings without silently dropping the middle.
- While interpreting a capture, the system shall retain the complete original
  text and include every section in analysis before publishing its synthesis.
- While interpreting long content, the system shall limit execution to 24 source
  sections of at most 48,000 UTF-16 units each and 15 minutes; oversized text
  shall fail explicitly before model calls rather than silently omit sections.

### Optional

- Where automatic organization or research is enabled, the system shall enforce
  bounded concurrency, attempts, duration and search calls per execution.
- Where external research is enabled by a user, the system shall support manual
  research or automatic research of new captures, with at most three discovery
  calls, four page fetches, three execution attempts and ten minutes per run.
- Where external research has not been enabled, the system shall perform no
  background research calls.
- While research is executing, the system shall permit at most one valid
  execution lease across web processes, renew it during provider calls and
  enforce ten minutes from the first claim across retries, excluding queue time.
- Where research uses corrected source text, the system shall bind its settings
  snapshot to that correction revision and invalidate it when the source changes.

### Unwanted behavior

- If generation has no supported external citation, then the system shall not
  publish it as grounded research.
- If ownership, source version or lease changes, then the system shall reject
  stale publication and preserve the new owner's state.
- If fetched data contains instructions, then the system shall treat them as
  source material and shall not grant them permissions.

## Acceptance criteria

- [ ] Publication schedules independent, deduplicated derived work.
- [x] Long-source tests cover facts in the middle of the source.
- [ ] Organization preserves manual changes and links evidence-backed content.
- [ ] Research produces sourced, reviewable context or an explicit no-research result.
- [ ] Source changes, review transitions and deletion update retrieval and graph.
- [ ] Configuration, costs, cancellation and failures are visible in both locales.
- [ ] Owner isolation, stale publication and retries are regression-tested.

## Delivery increments

1. Complete long-source capture analysis, including bounded synthesis, Unicode
   boundaries, cancellation and the cost of completed sections before a retry.
2. Independent external research scheduling, review and lifecycle controls.
3. Source-grounded background organization and entity relationships.

Increment 1 does not claim to implement background research or its review UI.

## Out of scope

Unbounded crawling, automatic acceptance of external claims, rewriting original
source claims, paid-user quotas and arbitrary code execution.

## Increment 2 review interface

- The document reader keeps external research after the original source, with
  owner-scoped history pages and direct links to older results.
- An always-mounted polite status region announces queue, cancellation,
  completion and review transitions. Failures expose safe recovery actions.
- Sources, verified excerpts, retrieval dates, queries, model usage and costs
  are available in a disclosure. Unknown provider cost is identified explicitly.
- Context editing uses a desktop dialog or a mobile sheet. It preserves the
  observed revision/checksum and draft through polling and conflicts.
- Accepted external context supports bounded assistant continuation reads with
  a required revision after the initial window and safe Unicode boundaries.
- Native keyboard, installation and screen-reader speech require physical
  device validation; browser viewport emulation is not evidence of those.

Local implementation and review evidence do not by themselves establish CI or
production delivery. Increment 3 organization and spec 230 remain separate.

Increment 2 was delivered through PR #1097 at merge `b224f3be` on 2026-11-14.
Its forward migration, deployed revision, health and synthetic review flows
were verified. This does not establish the accuracy of live research models.

## Increment 3 — source-grounded organization

### Ubiquitous

- The system shall keep source-grounded graph organization separate from
  external research, preserve the existing folders and tags, and never replace
  manually named nodes, relationships or organization choices.
- The system shall attach verified source excerpts and current source/correction
  revisions to each generated relationship; matching a name alone shall not
  establish a relationship.
- The system shall distinguish captured source, user-corrected source and
  externally prepared documents in persisted organization evidence. Generated
  summaries, visual descriptions and audience comments shall not independently
  substantiate captured-source relationships.
- The system shall reuse unambiguous owned topic/entity identities and shall
  preserve distinct identities when aliases are ambiguous.

### Event-driven

- When organization is enabled, the system shall support an explicit request
  for an active document or automatic organization of new captures collected
  since automatic consent began, independently of capture completion.
- When analyzing a long source, the system shall analyze every bounded section
  and retain completed section results and usage through retries.
- When extracting organization evidence from a captured document, the system
  shall use source spans recorded during publication and bound to the canonical
  Markdown checksum, retaining the actual Markdown offsets and line anchors.
- When a captured source has corrections, the system shall preserve unchanged
  source provenance and mark eligible edited source spans as user-corrected;
  edits to generated or audience sections shall not promote them to source.
- When a source or correction changes, the system shall invalidate its old
  generated evidence before it can be used as current knowledge.
- When a user disables organization or cancels a run, the system shall fence
  late publications without removing already valid source evidence.
- When fresh evidence supports organization hidden by a source lifecycle
  change, the system shall reuse its prior identities and relationships while
  preserving explicit manual archives and deletions, including identities
  previously resolved through unambiguous eligible aliases.
- When a source returns to a previously analyzed snapshot and fresh analysis
  verifies that snapshot, the system shall restore the matching evidence's
  validity and retain it through unchanged archive/restore transitions.

### State-driven

- While organization is executing, the system shall allow one valid execution
  lease across web processes, at most three attempts per section, and at most
  fifteen minutes from the first claim across retries.
- While organizing source text, the system shall use at most 24 sections of at
  most 48,000 UTF-16 units each, including sources between 48,001 and 60,000 units.
- While organization is pending or fails, the original document, manual graph
  and keyless lexical retrieval shall remain usable.

### Optional

- Where organization has not been enabled, the system shall make no additional
  organization model calls. Capture interpretation and keyless graph indexing
  shall retain their existing behavior.
- Where organization is enabled, the interface shall disclose its use of the
  configured Standard model, progress, cost or unknown cost, cancellation and
  safe failures in both supported locales.
- Where organization controls appear in the reader, the interface shall keep
  the original content first, provide compact expandable execution history and
  stable links to older runs, and announce progress through a mounted status
  region. Temporary submission or read failures shall not imply an archive.
- Where a current organization excerpt is returned to graph, MCP or assistant
  consumers, the system shall retain its recorded captured, corrected or
  prepared authority. Legacy evidence without authority shall not be promoted
  to a verified captured-source classification.

### Unwanted behavior

- If a model invents an excerpt, references an unknown endpoint or supplies a
  relationship whose excerpt does not contain both endpoint names, then the
  system shall omit that item and report the unsupported output.
- If an owner, execution lease, consent or source snapshot no longer matches,
  then the system shall reject publication atomically.
- If a duplicate capture publishes after another attempt has committed, then
  the system shall preserve the committed canonical object and its evidence
  manifest rather than overwrite them with the duplicate's rendering.
- If refresh publications race, then the system shall revalidate the owned
  source under its publication lock, preserve an already committed same-job
  result, and reject a different changed baseline before modifying source
  snapshots, chunks or the current document.
- If a library already contains unfinished compilation records from the retired
  executor, then the new executor shall not run them without current consent
  and an explicit current-version execution snapshot.
- If captured-source provenance is absent, corrupted or cannot be mapped to an
  edited source within bounded work, then the system shall reject organization
  with an explicit provenance error before model calls. Older captures without
  a publication span manifest require reprocessing; their original content,
  existing organization and keyless retrieval remain available.

### Acceptance

- [ ] Complete source analysis produces verified excerpts with line anchors.
- [ ] Owned identities are reused without merging ambiguous aliases.
- [ ] Atomic publication preserves manual graph, folders, tags and source text.
- [ ] Consent, deduplication, retry usage and restart recovery are tested.
- [ ] Cancellation, corrections, refresh, archive and deletion fence stale work.
- [ ] Localized controls and mobile sheets are validated before delivery.

### Durable execution boundary

- The system shall store new organization runs and section receipts separately
  from retired compilation records, preserving run history and completed
  publications when a conversation or preference changes.
- When queueing, the system shall bind the current owned source, canonical
  provenance and consent to the run and deduplicate retries by request key.
- When retrying, the system shall preserve the Standard model identifiers and
  reasoning settings, resolve credentials only for the current owner, and skip
  section receipts already committed with their graph effects.
- When a section analysis completes, the system shall persist its validated
  result and usage before graph projection; retries of that saved analysis
  shall revalidate its evidence without another provider dispatch.
- While executing a run, the system shall permit at most three execution claims
  within the original fifteen-minute deadline, preserving completed section
  receipts and cached analyses across those attempts.
- If a provider call was reserved but its usage cannot be confirmed after a
  restart, then the system shall disclose unknown cost rather than report zero.
