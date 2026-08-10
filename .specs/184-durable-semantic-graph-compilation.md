# Spec 184 — Durable semantic graph compilation

## Context

The Brain materializes canonical source nodes and separately compiles grounded
entities, claims, and relations from transcript segments. When the shared graph
lease is unavailable, the current extraction can stop after creating pending
segments without leaving durable retry scheduling. The source coverage can then
report ready while semantic coverage remains incomplete indefinitely.

This specification makes semantic compilation resumable and observable without
allowing concurrent workers to charge the same model call or write stale
evidence after the canonical source changes.

## Glossary

- **Source coverage**: canonical transcript, note, folder, and accepted enrichment
  nodes materialized in Brain.
- **Semantic coverage**: transcript segments whose grounded extraction reached a
  terminal state.
- **Claim**: an atomic durable ownership transition for one compilation segment.
- **Write lease**: the short-lived per-user Redis lease required to mutate Brain
  nodes, edges, and evidence.

## Requirements

### Ubiquitous

- The system shall persist attempts, execution timestamps, retry scheduling, and
  the last safe error code for every semantic compilation segment.
- The system shall treat source coverage and semantic coverage as separate
  observable measurements.
- The system shall scope every compilation claim, source read, and Brain write to
  the owning user.
- The system shall preserve canonical transcript text and manual graph evidence
  during semantic retries.
- The system shall limit each segment to six model attempts.

### Event-driven

- When a transcript prepares semantic segments, the system shall atomically claim
  only due segments that are not owned by another live worker.
- When a worker claims a segment, the system shall record a bounded ownership
  deadline before invoking the model.
- When model extraction succeeds, the system shall acquire the write lease only
  for materialization and shall verify the compilation content hash before
  persisting evidence.
- When the write lease is unavailable, the system shall schedule the segment for
  retry without repeating the successful model call in the same execution.
- When a worker stops after claiming a segment, the system shall recover the
  expired claim and make it retryable.
- When a segment reaches its attempt limit, the system shall mark it failed with a
  terminal safe error code.
- When all segments reach a terminal state, the system shall refresh compilation
  counters and status deterministically.
- When the periodic worker reconciliation runs, the system shall dispatch due
  semantic compilations within the configured enrichment concurrency limit.

### State-driven

- While a segment claim is live, the system shall prevent other workers from
  claiming the same segment.
- While a source hash differs from the claimed compilation hash, the system shall
  reject the stale write and rebuild segments from the current canonical source.
- While semantic coverage is incomplete, the graph status shall expose pending,
  running, retrying, failed, completed, and total segment counts without treating
  canonical source nodes as missing.

### Optional

- Where Redis is temporarily unavailable, the system shall preserve pending work
  in Postgres and retry after the configured backoff.

### Unwanted behavior

- If a claimed segment belongs to another user, then the system shall hide its
  existence and perform no model call or mutation.
- If two workers reconcile at the same time, then the system shall not run the
  same segment model call concurrently.
- If a model or provider error contains sensitive details, then the system shall
  persist and log only a bounded safe error code.
- If materialization loses its write lease, then the system shall roll back the
  segment transaction and retain retryable work.
- If a compilation is skipped because model configuration is unavailable, then
  the system shall expose it as skipped rather than pending forever.

## Acceptance Criteria

- [x] A migration adds durable claim and retry fields without changing completed
      historical segments.
- [x] Tests prove that concurrent claims return each due segment once.
- [x] Tests prove that expired running claims become retryable.
- [x] Tests prove that model extraction runs without holding the graph write
      lease.
- [x] Tests prove that lease contention schedules retry instead of leaving a
      permanent pending segment.
- [x] Tests prove that stale content hashes cannot persist graph evidence.
- [x] Tests prove that the six-attempt limit becomes terminal and does not loop.
- [x] The reconciliation loop resumes legacy pending compilations automatically.
- [x] Graph status reports source and semantic coverage independently.
- [x] Existing source materialization, grounded evidence isolation, and lease
      rollback tests remain green.
- [x] Worker lint, typing, tests, migration gate, and container build pass.

## Out of Scope

- Pagination and server-side exploration of more than the graph snapshot limit.
- Surgical editing of notes or transcript corrections.
- Visual changes to the graph page.
- Changing the model selected for grounded extraction.

## Risks / Open Decisions

- Model output is not persisted before the write lease is acquired. A lease miss
  therefore repeats the model call on a later attempt; this favors data
  minimization over storing unreviewed model payloads.
- The shared graph lease remains authoritative for Brain writes, but no longer
  covers network-bound model execution.

> 2026-08-09: approved as the first implementation increment of the owner-approved
> graph reliability, surgical editing, Mermaid interaction, and bilingual search
> roadmap.
