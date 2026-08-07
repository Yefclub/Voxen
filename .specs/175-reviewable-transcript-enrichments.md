# Spec 175 — Reviewable, grounded transcript enrichments

## Context

External research must not be appended to a summary as though it came from the
source. The product needs a separately cited, reviewable, removable derived
object that never mutates the transcript or `summaryMd`.

## Requirements

### Ubiquitous

- The system shall store each enrichment's owner, transcript, source version,
  type, title, Markdown, structured citations, queries, model, cost, trigger,
  freshness, operational status, and review status.
- The system shall support `SUGGESTED`, `ACCEPTED`, and `DISMISSED` review
  states and explicit execution/failure states.
- The system shall keep the canonical transcript and summary immutable across
  the entire enrichment lifecycle.
- The system shall treat source text, results, titles, snippets, and URLs as
  untrusted data.

### Event-driven

- When a suggested enrichment is accepted, the system shall make it searchable
  and index it in Brain as an external derived source with less authority than
  the transcript.
- When an enrichment is edited, the system shall retain external provenance
  and record that the user edited it.
- When an enrichment is dismissed or deleted, the system shall remove only its
  search and Brain derivatives.
- When the transcript version changes or freshness expires, the system shall
  mark the enrichment stale.

### State-driven

- While an enrichment is `SUGGESTED`, the system shall display it for review
  and exclude it from default factual retrieval and Brain.
- While an enrichment is `ACCEPTED`, the system shall expose its explicit
  external type, citations, and status in search, agents, and MCP.

### Unwanted behavior

- If factual output has no usable citation URL, then the system shall reject it
  as a valid suggested enrichment.
- If Markdown or a URL is unsafe, then the system shall sanitize rendering and
  prevent script or tool execution.
- If an enrichment belongs to another user, then the system shall hide its
  existence.

## Acceptance criteria

- [x] Prisma and API represent content, citations, review, execution, and
  freshness.
- [x] The transcript page can accept, edit, dismiss, regenerate, and delete.
- [x] Suggested items are excluded from retrieval/Brain; accepted items are
  included with an explicit source type.
- [x] Removal deletes only the enrichment's derived data.
- [x] Web APIs and MCP expose reads and transitions with the correct scopes.
- [x] Citations, bounds, sanitization, and user isolation are validated.
- [x] Tests cover lifecycle, staleness, prompt injection, and graph cleanup.

## Out of scope

- Merging research into `summaryMd`.
- Treating external context as a transcript claim.
- Automatically accepting generated research.
