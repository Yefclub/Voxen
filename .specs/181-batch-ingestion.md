# 181 — Batch ingestion

## Status

Implemented on `feat/batch-ingestion`.

## Problem

Voxen accepts only one URL per application, chat, or MCP request. Users collecting several
sources must repeat the same action and cannot see which input was queued, already present,
invalid, or already running.

## Contract

- A batch contains 1–20 URL inputs.
- Every URL produces an independent result and, when accepted, an independent durable `Job`.
- One invalid or duplicate item never rolls back accepted siblings.
- The existing single-URL endpoints and tools remain backward compatible.
- Results preserve input order and expose `created`, `existing_transcript`, `inflight`,
  `invalid`, or `setup_incomplete` outcomes.
- Canonical URL and active-job constraints remain the source of truth for deduplication.
- Authentication, settings snapshots, queue events, and all identifiers remain scoped to the
  authenticated user.

## Surfaces

- `POST /api/jobs/batch` accepts `{ "urls": string[] }`.
- The library ingest card accepts one URL per line and shows a result for every input.
- Chat adds `request_transcriptions` and automatically selects it for explicit multi-link turns.
- MCP adds `voxen_request_transcriptions`, while retaining `voxen_request_transcription`.

## Failure and rollback

Batch orchestration is deliberately partial-success. Unexpected infrastructure failures are
reported for the affected input without deleting jobs already durably created for prior inputs.
No schema migration or worker change is required; rollback removes the plural surfaces while
single ingestion continues unchanged.

## Verification

- API tests cover order, mixed outcomes, input bounds, per-user isolation, and independent jobs.
- Chat tests cover explicit multi-link routing and tool validation.
- MCP tests cover discovery, scope classification, and mixed batch results.
- UI contract tests cover parsing and ordered result presentation.
