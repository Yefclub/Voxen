# Spec 211 — Concurrency-safe enrichment commands and durable graph projection

## Context

MCP-15 identifies read-then-update review/edit operations and graph writes after
canonical persistence. Concurrent clients can overwrite an unseen edit; a graph
failure can report a failed action after the canonical action already succeeded.
The owner approved completing this audit backlog and deploying the result.

## Requirements

### Ubiquitous
- The system shall share owner-scoped transactional enrichment mutation commands between REST and MCP.
- The system shall expose a canonical revision/checksum and require matching preconditions before review, edit or cancellation.
- The system shall record pending graph projection in the same transaction as canonical mutation.
- The system shall expose projection state separately from canonical completion and keep reads free of repair side effects.
- The system shall preserve citation identity, current source freshness and parent ownership/lifecycle boundaries.

### Event-driven
- When two clients mutate the same observed enrichment, the system shall apply at most one mutation and return a conflict requiring a fresh read to the other.
- When worker or maintenance changes alter canonical content/state, the system shall detect a stale checksum even if the manual revision has not changed.
- When accepted content is edited or dismissed, the system shall repair or remove its graph projection through durable bounded work.
- When projection fails or capacity is unavailable, the system shall retain retryable work without claiming that the committed canonical mutation failed.
- When a newer canonical mutation races a projection, the system shall acknowledge only the observed current revision/checksum.

### State-driven
- While projection is pending, the system shall prevent an older graph snapshot from appearing as current accepted evidence.
- While a user is editing a captured UI snapshot, the system shall retain its original preconditions through polling and conflict responses.

### Unwanted behavior
- If the parent is inactive, foreign or source-stale, then the system shall reject acceptance atomically.
- If completion races cancellation, then the system shall reject the outdated cancellation without modifying a completed execution.
- If a credential lacks WRITE, then the system shall keep all mutation commands unavailable.

## Acceptance criteria
- [x] Revision/checksum and projection state are present in REST/MCP reads and validated tool outputs.
- [x] REST and MCP share one transactional command boundary with mandatory preconditions.
- [x] Concurrent edits/reviews, worker changes and publication/cancellation races have real database regressions.
- [x] Canonical writes and pending projection commit atomically; projection failure remains repairable after restart.
- [x] Graph leases, bounded retries and late acknowledgements cannot lose newer work.
- [x] Current graph reads reject pending/older enrichment snapshots; reads do not mutate records.
- [x] UI captures edit preconditions, preserves drafts on conflict and explains projection state.
- [x] English/PT-BR MCP guidance and output/input schemas describe the new contract.
- [x] Playwright verifies changed controls in four themes and mobile.
- [ ] Full checks, migration/quality gates, actual build and independent review pass without weakening baselines.

## Decisions

Manual review/edit/cancel commands increment a durable integer revision; a
canonical checksum detects worker/maintenance changes to the observed content
and state. Lock the owned parent and enrichment consistently before checks and
mutation. Store projection work on the canonical enrichment row, preserving
existing records and credentials through an additive migration. Projection uses
owner graph leases, current lifecycle checks and conditional acknowledgement.
It never holds the canonical transaction across graph materialization. Retry
bookkeeping must not change canonical timestamps or consume a client's revision.

## Validation

Real database concurrency/projection tests passed, including persisted retry,
late acknowledgement and obsolete graph stamps. Actual legacy and modern MCP
clients passed read/write/conflict contract checks. The additive migration gate
passed. Browser verification passed conflict draft retention, fresh editing,
acceptance and dismissal in four themes, mobile and English/PT-BR. The mobile cancellation control and localized retry badge also passed. Final full
checks, runtime image and review are pending.
