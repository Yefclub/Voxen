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
2. Independent organization/research scheduling, review and lifecycle controls.

Increment 1 does not claim to implement background research or its review UI.

## Out of scope

Unbounded crawling, automatic acceptance of external claims, rewriting original
source claims, paid-user quotas and arbitrary code execution.
