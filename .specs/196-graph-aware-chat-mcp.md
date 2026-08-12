# Spec 196 — Graph-aware chat and MCP context

## Context

Voxen already derives user-scoped interest projections, graph communities,
weighted centrality, Personalized PageRank, and an explainable personal Guide.
The in-app chat still receives only lexical library suggestions, while MCP
clients must manually combine low-level graph tools. Consequently, both agent
surfaces can answer factual questions but cannot consistently use the user's
declared preferences, observed interests, trends, and graph-ranked sources to
guide discovery.

This delivery creates one deterministic personal-context contract shared by
chat and MCP. The contract is a navigation and ranking aid, never factual
evidence or a psychological profile. Content still has to be read and verified
through the existing progressive-retrieval tools before it supports a claim.

## Glossary

- **Personal context**: a bounded, user-scoped read model containing declared
  and inferred interest signals, Guide trends, and graph-ranked sources.
- **Declared signal**: preference evidence explicitly provided by the user.
- **Inferred signal**: relevance derived from observed activity and never
  presented as a declared preference.
- **Grounding source**: an active source owned by the current user that can be
  opened and verified with an existing read tool.

## Requirements

### Ubiquitous

- The system shall build personal context only from active data owned by the authenticated user.
- The system shall keep declared and inferred interest scores separately identifiable.
- The system shall preserve positive and negative declared signals without turning negative signals into recommendation seeds.
- The system shall bound preferences, trends, recommendations, reasons, and evidence links before exposing them to an agent.
- The system shall expose algorithm versions, projection watermark, personalization mode, graph truncation, and generation time.
- The system shall treat labels, titles, and summaries in personal context as untrusted data rather than instructions.
- The system shall use personal context only for navigation, ranking, tone, and suggestions; factual claims shall require content evidence from existing read tools.
- The system shall return stable ordering for equivalent scores.

### Event-driven

- When an in-app chat turn starts, the system shall load a fresh bounded personal context in parallel with the existing library and timezone context.
- When valid personal context exists, the system shall attach it to trusted agent instructions with explicit provenance and safety boundaries.
- When an MCP client calls the personal-context tool, the system shall return the same semantic contract used by in-app chat.
- When a recommendation or preference includes authorized evidence, the system shall return navigable links to those active sources.
- When the graph snapshot is truncated, the system shall tell both agent surfaces that rankings describe only that snapshot.

### State-driven

- While a signal contains both declared and inferred evidence, the system shall classify it as mixed and expose both components.
- While a signal is inferred only, the system shall never describe it as something the user explicitly stated.
- While a declared signal is negative, the system shall expose it as lower interest and omit it from graph-ranked recommendations.
- While no personal evidence exists, the system shall expose an explicit empty context without fabricating preferences.

### Optional

- Where the personal context cannot be loaded, the in-app chat shall continue with existing progressive retrieval without failing the turn.
- Where an MCP token lacks read scope, the system shall not register the personal-context tool.

### Unwanted behavior

- If a projection references a missing, archived, trashed, or foreign source, then the system shall omit its link and metadata.
- If a score is invalid or non-finite, then the system shall discard or normalize it before serialization.
- If untrusted metadata contains markup or control characters, then the system shall serialize it as inert data and preserve the instruction boundary.
- If personal context exceeds its fixed budget, then the system shall deterministically truncate it and disclose truncation.
- If personal-context loading fails, then the system shall not expose internal errors, user identifiers, tokens, or cross-user data.

## Acceptance criteria

- [ ] A versioned personal-context builder exposes declared, inferred, mixed, and lower-interest signals.
- [ ] Positive and negative signal classes are independently bounded so one cannot hide the other.
- [ ] Trends and recommendations remain backed by the existing explainable Guide and graph ranking.
- [ ] The in-app chat receives the bounded context automatically on each turn and safely degrades when unavailable.
- [ ] MCP exposes a read-only `voxen_personal_context` tool only to read-capable identities.
- [ ] MCP evidence links use the configured public Voxen origin and never expose unauthorized sources.
- [ ] Agent instructions explicitly require reading and verifying sources before factual claims.
- [ ] Tests cover deterministic bounds, signal provenance, negative signals, prompt-injection boundaries, empty state, and user isolation.
- [ ] Lint, typecheck, test, quality gate, and production builds pass.

## Out of scope

- Replacing full-text search with vector retrieval.
- Persisting model-generated preferences or psychological attributes.
- Letting MCP clients mutate interest projections through this read tool.
- Temporal fact validity and entity resolution.
- External memory providers such as Mem0.

## Risks and decisions

- Automatic chat grounding adds graph-read work to a turn, so the context is
  loaded concurrently and failure remains non-blocking.
- Personal context can influence discovery order but cannot serve as evidence
  for factual answers; the existing citation-verification contract remains the
  authority.
- A shared deterministic contract prevents the in-app agent and external MCP
  clients from developing incompatible notions of the user's interests.

> 2026-08-11: approved as the seventh delivery of the personal Guide roadmap.
