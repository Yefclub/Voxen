# Spec 195 — Explainable personal Guide

## Context

Voxen already records explicit and observed interest events, separates short-,
medium-, and long-term projections, detects graph communities, and calculates
weighted structural and personalized centrality. Those signals are currently
visible only as isolated controls or graph statistics. Users still lack a
single place that answers what their knowledge base says they care about, what
is changing, and which existing sources are worth revisiting.

This delivery introduces a deterministic personal Guide. It combines only
authorized knowledge-graph data and stored interest projections, keeps durable
preference separate from inferred behavior, and explains every surfaced trend
or source with inspectable evidence. It does not ask a language model to infer
new preferences and does not persist recommendations as knowledge facts.

## Glossary

- **Guide**: a user-scoped read model of interests, trends, communities, and
  sources from the existing knowledge base.
- **Trend**: the relationship between the same feature's short-, medium-, and
  long-term projection scores.
- **Emerging**: positive short-term relevance materially above long-term
  relevance.
- **Steady**: positive relevance supported across multiple horizons without a
  material short-term decline.
- **Cooling**: historically positive relevance whose short-term score has
  materially declined.
- **Evidence**: stored explicit feedback, observed events, source references,
  community membership, or graph-ranking metrics that justify an item.

## Requirements

### Ubiquitous

- The system shall build the Guide only from data owned by the authenticated user.
- The system shall keep explicit, inferred, and graph-derived evidence separately identifiable.
- The system shall classify trends deterministically from versioned projection scores.
- The system shall rank source recommendations with weighted Personalized PageRank without replacing structural PageRank.
- The system shall provide at least one inspectable reason for every recommendation.
- The system shall link evidence and recommendations only to active, user-owned sources.
- The system shall expose algorithm versions, projection watermark, graph truncation, and generation time.
- The system shall provide Portuguese and English interface copy.

### Event-driven

- When interest projections change, the system shall rebuild the Guide from the new projection watermark.
- When positive durable seeds match the graph, the system shall prefer sources connected to those seeds and explain the match.
- When no durable seed matches the graph, the system shall use structural relevance and identify the fallback.
- When a user opens a trend, the system shall expose its horizon scores and supporting source links.
- When a user opens a recommendation, the system shall navigate to the canonical transcript detail page.

### State-driven

- While explicit and inferred evidence coexist, the system shall show both counts without presenting observation as declared preference.
- While the graph snapshot is truncated, the system shall disclose that rankings describe only the returned snapshot.
- While the Guide is loading, the system shall preserve the application shell and show a bounded loading state.
- While the user has insufficient evidence, the system shall show an onboarding state instead of fabricated trends.

### Optional

- Where a recommended source belongs to a detected community, the system shall show the community label and cohesion as supporting context.
- Where a recommendation has positive personalization lift, the system shall identify it as more relevant to this user than to the graph globally.

### Unwanted behavior

- If a negative projection is present, then the system shall never convert it into a positive recommendation seed.
- If a projection references a missing or unauthorized source, then the system shall omit that evidence without exposing its identifier.
- If graph ranking or community detection cannot produce a result, then the system shall return a valid partial Guide rather than invent evidence.
- If scores are invalid or non-finite, then the system shall clamp or discard them before ranking or rendering.
- If two items have equal scores, then the system shall use stable labels and identifiers as deterministic tie-breakers.

## Acceptance criteria

- [x] A dedicated `/guia` page is available from desktop and mobile navigation.
- [x] The page separates emerging, steady, and cooling interests.
- [x] Each trend exposes short-, medium-, and long-term scores plus explicit and observed evidence.
- [x] Recommended sources use personalized graph ranking when valid seeds exist.
- [x] Every recommendation includes inspectable interest, community, or structural evidence.
- [x] Evidence links resolve only to active transcripts owned by the current user.
- [x] Empty, partial, uniform-fallback, and truncated-graph states are explicit and accessible.
- [x] The API returns versioned deterministic metadata without calling an LLM.
- [x] Tests cover trend classification, recommendation ranking, negative-signal exclusion, fallback, and user isolation.
- [x] Desktop and smartphone layouts are visually verified in both supported locales.

## Out of scope

- Using session intent to rewrite durable preferences.
- Graph-aware chat or MCP retrieval.
- Temporal fact validity and entity resolution.
- Generating prose recommendations with a language model.
- Importing or storing external user-memory services.

## Risks and decisions

- The Guide is a read model, not an authoritative psychological profile. The UI
  must describe signals as evidence from the user's own activity and feedback.
- Rankings reflect the bounded graph snapshot and must surface truncation.
- Trend thresholds are versioned constants so later calibration can be audited
  without silently changing previous semantics.

> 2026-08-11: approved as the sixth delivery of the personal Guide roadmap.
