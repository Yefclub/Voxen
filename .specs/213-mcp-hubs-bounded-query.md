# Spec 213 — Reliable bounded MCP hub queries

## Context

The live security deployment is healthy, but the hub query on the actual graph
(6,682 nodes and 13,378 edges) approaches the new three-second SQL budget. Its
OR endpoint join and repeated source-lifecycle conditions can exceed the budget
under normal load. Optimize the query instead of increasing the deadline.

## Requirements
- The system shall validate owned/current endpoints through indexed node joins.
- The system shall aggregate eligible edge endpoints without a per-node OR join.
- The system shall preserve ownership, lifecycle and source-provenance filtering.
- The system shall count self-loops once and maintain deterministic hub ordering.
- The system shall retain the three-second SQL and overall request deadlines.

## Acceptance criteria
- [x] Scaled graph regression passes within the existing deadline.
- [x] Self-loops, foreign edges and inactive/invalid source endpoints are handled correctly.
- [x] Full checks, quality gates, real image build and independent review pass.
- [ ] The actual deployed graph passes both MCP protocol probes after rollout.


## Decisions

Aggregate edges first using indexed node identities. A shared materialized node
CTE can choose quadratic rescans when a newly inserted owner is absent from
statistics; keep primary-key uniqueness visible to the planner. Disable JIT only
inside bounded MCP read transactions to avoid compilation consuming the deadline.

## Validation

All local checks and dependency audit passed. Coverage: web 49.49%, worker
73.78%; duplication 2.44%. The combined Docker Compose image built successfully
from commit 9cdad34. Independent review approved that commit.
