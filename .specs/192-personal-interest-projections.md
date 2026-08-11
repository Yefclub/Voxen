# Spec 192 — Personal interest projections

## Context

Voxen now records passive transcript views separately from explicit “more like
this” and “less like this” choices. A personal Guide still needs a stable read
model that can distinguish durable declarations, inferred interest, and the
temporary intent of the current session. Blending those concepts would allow a
single research detour to rewrite the user's long-term profile.

This increment creates explainable short-, medium-, and long-term projections
from the existing event history and knowledge graph. It does not yet rank the
Guide, chat, or MCP results.

## Glossary

- **Explicit preference**: the latest reversible declaration attached to a
  transcript. It may be positive, negative, or cleared.
- **Inferred interest**: a weak, decaying signal derived from observed views.
- **Session intent**: an ephemeral direction for one active session, stored in
  Redis with a bounded lifetime and never merged into durable projections.
- **Projection**: a materialized, user-scoped read model for one time horizon.
- **Feature**: a topic, entity, tag, folder, author, channel, or source connected
  to a transcript.

## Requirements

### Ubiquitous

- The system shall keep explicit preference, inferred interest, and session intent as separate fields and stores.
- The system shall scope every projection and session-intent key to the authenticated user.
- The system shall derive projection features only from transcripts visible to their owner and from that owner's graph, tags, and folders.
- The system shall store bounded evidence identifiers and counts without copying transcript bodies, queries, or chat messages.
- The system shall expose the algorithm version, time window, half-life, event watermark, and computation time with every projection.
- The system shall preserve negative explicit preferences instead of converting them into absence of interest.

### Event-driven

- When projections are missing, stale, or behind the latest interest event, the system shall rebuild all three horizons before returning them.
- When projections are rebuilt, the system shall atomically replace the user's short-, medium-, and long-term snapshots.
- When a valid session intent is recorded, the system shall replace the same user's same-session intent and apply a two-hour expiry.
- When a session intent is cleared, the system shall remove only that user's same-session Redis key.

### State-driven

- While calculating inferred interest, the system shall apply stronger recency decay to the short horizon and weaker decay to the long horizon.
- While an explicit preference remains active, the system shall apply its latest state to every horizon without counting superseded events.
- While Redis is unavailable, the system shall keep durable projections readable and report session intent as unavailable rather than persisting it elsewhere.
- While a transcript is archived, the system shall retain its signals; while it is trashed, the system shall exclude it from future projection rebuilds.

### Optional

- Where a projection feature maps to a Brain node, the system shall include the node identifier so later ranking can traverse the graph without label matching.
- Where a caller supplies a session identifier, the system shall return that session intent beside, but never blended into, the durable horizons.

### Unwanted behavior

- If a session identifier or intent item is malformed, then the system shall reject it without writing to Redis.
- If a caller requests an immediate rebuild too frequently, then the system shall rate-limit the request without deleting existing snapshots.
- If an event references content that is no longer visible, then the system shall omit that content and its features from the rebuilt projection.
- If two features share a label but have different dimensions or canonical keys, then the system shall not merge them by display text alone.
- If the latest explicit event clears a preference, then the system shall contribute no positive or negative explicit score for that transcript.

## Acceptance criteria

- [x] Prisma persists three user-scoped projection snapshots with cascade deletion and a unique horizon per user.
- [x] A deterministic projection engine builds short, medium, and long horizons with documented windows and half-lives.
- [x] The engine separates `explicitScore`, `inferredScore`, and `score` for every feature and keeps bounded evidence.
- [x] The latest explicit state wins per transcript, including negative and cleared states.
- [x] Tags, folders, authors, channels, sources, Brain topics, and Brain entities can become projection features.
- [x] Session intent is user/session scoped, validated, replaceable, clearable, and expires from Redis without affecting durable projections.
- [x] Authenticated account endpoints expose projections, controlled rebuild, and optional session intent.
- [x] Tests cover decay, separation, negative and cleared preferences, isolation, archived/trash behavior, graph linkage, freshness, Redis outage, and expiry.

## Out of scope

- Rendering the final Guide or changing recommendation ranking.
- Leiden communities, weighted centrality, or personalized PageRank.
- Feeding personal projections into chat or MCP prompts.
- Recording search terms, chat text, citation clicks, shares, or ingestion as new events.
- Temporal fact validity and assisted entity resolution.
- Mem0 integration.

## Risk decisions

- Observed views remain weak and positive-only. They can raise inferred interest
  but never cancel a negative explicit declaration.
- Explicit state is evaluated from the latest event per transcript instead of
  accumulating every historical toggle.
- Session intent is deliberately volatile. Losing Redis loses only that
  temporary intent, never the durable profile or source events.
