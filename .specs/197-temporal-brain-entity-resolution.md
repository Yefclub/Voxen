# Spec 197 — Temporal Brain facts and reversible entity resolution

## Context

The Brain already preserves literal evidence and segment locations, but its
semantic topology still has two unsafe shortcuts:

- an extracted entity is keyed mostly by a normalized label, so homonyms can be
  collapsed before enough context exists;
- a relation says when it was stored, but not when the source says it was valid.

For a personal knowledge base, "the user likes X now", "the user liked X in
2024", and "this source was collected today but describes 2021" are different
facts. Entity aliases also need to improve recall without destructively merging
identities.

This design follows the useful parts of temporal context graphs—validity windows,
ingestion time, and source episodes—while retaining Voxen's Postgres-first model.
Graphiti is a design reference, not a runtime dependency:

- https://github.com/getzep/graphiti
- https://github.com/getzep/graphiti/tree/main/examples/quickstart

## Decisions

- `BrainEdge` remains the current navigable topology.
- `BrainFact` versions the grounded meaning attached to an edge. It stores domain
  time (`validFrom`/`validTo`) separately from observation/ingestion time.
- `BrainSource` remains the evidence ledger and may point at a fact version.
- `BrainEntityAlias` is an evidence-backed, user-scoped lookup candidate. An alias
  never rewrites or deletes a node.
- Entity resolution is conservative. A unique, high-confidence compatible
  candidate may be reused; ambiguous candidates stay separate and can be joined
  by reversible `SAME_AS` evidence.
- Temporal extraction accepts only ISO timestamps returned beside a literal
  grounded excerpt. Missing time remains `null`; a supplied malformed time
  rejects the relation instead of turning it into an undated fact.
- Entities and relations use extraction-local references, so homonyms that
  coexist in one segment retain distinct identities and evidence paths. The
  same normalizer is used on definitions and references; normalized collisions
  and ID/label contradictions are rejected instead of guessed. Local references
  remain part of persisted contextual identity and evidence keys, and explicit
  peers in one payload cannot resolve onto the same node.
- Transcript lifecycle mutations share the graph-write lease and serialize on
  the transcript row. A grounded segment can commit only while that exact
  source version is still `ACTIVE`, preventing a concurrent worker from
  reactivating archived topology.
- Current and point-in-time retrieval return evidence and uncertainty. Overlapping
  facts are shown together rather than silently choosing a winner.

## Requirements

### Ubiquitous

- The system shall scope every fact, alias, resolution candidate, query, and
  source to one `userId`.
- The system shall distinguish domain validity time from observation/ingestion
  time.
- The system shall preserve old fact versions and their evidence when later
  content changes.
- The system shall make aliases reversible and evidence-backed.
- The system shall expose temporal facts only with their subject, predicate,
  object, confidence, method, validity window, and source evidence.
- The system shall treat extracted content and aliases as untrusted data.

### Event-driven

- When a grounded segment yields a relation, the system shall materialize an
  idempotent `BrainFact` and attach the segment evidence to it.
- When a grounded entity yields literal aliases, the system shall record each
  alias with its source and extraction confidence.
- When a segment is recompiled, the system shall invalidate superseded facts,
  aliases, and sources while preserving their immutable audit rows.
- When an entity alias resolves to exactly one compatible high-confidence
  candidate, the system may reuse that node without rewriting its identity.
- When alias resolution is ambiguous, the system shall preserve separate nodes.

### State-driven

- While `asOf` is supplied, temporal retrieval shall include facts whose validity
  interval contains that instant.
- While a range is supplied, temporal retrieval shall include facts whose
  validity interval overlaps the range.
- While no domain time is available, the fact shall remain queryable as
  undated and shall expose its observation time.
- While source content is archived or trashed, its facts and aliases shall not be
  used by default agent/MCP retrieval.
- While a grounded edge has no current evidence from an active transcript, the
  default navigable graph shall archive that edge and any grounded-only orphan
  nodes; restoring an active source shall reactivate supported topology.

### Optional

- Where a client asks by alias, Brain search may return compatible canonical
  entity candidates in addition to direct label matches.
- Where facts overlap or disagree, clients may present the set as disputed, but
  shall not auto-supersede evidence without an explicit validity boundary.

### Unwanted

- The system shall not merge entities only because their normalized names match.
- The system shall not use aliases or facts from another user.
- The system shall not overwrite historical fact meaning in `BrainEdge.metadata`.
- The system shall not infer `validFrom` from file creation time or video upload
  time.
- The system shall not present an alias resolution score as factual evidence.

## Agent and MCP contract

- In-app chat receives `brain_timeline` for bounded current, point-in-time, and
  range queries.
- MCP receives `voxen_brain_timeline` with the same semantics.
- `voxen_brain_sources` returns fact identity and temporal fields when the
  evidence belongs to a fact.
- Agent instructions require opening evidence before using a temporal fact as a
  factual claim.

## Acceptance criteria

- [ ] Migration replay succeeds from an empty database and preserves existing
      Brain rows.
- [ ] Temporal parsing rejects malformed or reversed validity intervals.
- [ ] Repeated compilation is idempotent for facts and aliases.
- [ ] Alias lookup improves recall without destructive node merges.
- [ ] Ambiguous aliases remain separate.
- [ ] Local-reference collisions, mismatched labels, and inactive-source races
      fail closed.
- [ ] Current, `asOf`, and range queries enforce user and active-source scope.
- [ ] Chat and MCP expose bounded temporal retrieval with citations.
- [ ] Source deletion/recompilation removes only orphaned derived records.
- [ ] Worker and web tests cover temporal semantics, alias ambiguity, isolation,
      lifecycle, and idempotency.

## Out of scope

- A mandatory graph database or external memory service.
- Automatic destructive entity merges.
- Guessing real-world validity dates from ingestion timestamps.
- UI-based manual merge/split controls; the data contract added here makes that
  safe to implement later.
