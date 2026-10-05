# Spec 207 — External ingestion recovery

## Context

Public TikTok ingestion fails with an outdated extractor, and several temporary
upstream failures are currently reported as permanent access blocks. This
specification covers the fault scenarios verified during the ingestion audit.

## Requirements

### Ubiquitous

- The system shall preserve source access restrictions, URL safety checks,
  cancellation, job lease fencing and canonical transcript checkpoints.
- The system shall expose only allowlisted operational error metadata and never
  provider bodies, signed URLs, cookies or credentials.
- The system shall limit automatic ingestion recovery to three claimed attempts.
- The system shall use patched source-processing dependencies for security
  advisories detected by the delivery checks, without changing their major versions.
- The default single-container deployment validation shall exercise storage
  persistence on a local volume without requiring an external object store.

### Event-driven

- When an upstream returns HTTP 408, 429 or 5xx, the system shall classify the
  failure as temporary and retry with bounded backoff.
- When a valid Retry-After is provided, the system shall respect its seconds or
  HTTP-date value, bounded to a maximum cooldown of one hour.
- When a cooldown exceeds five seconds or local retries are exhausted, the system
  shall persist delayed recovery in the existing queue and release worker capacity.
- When a temporary DNS lookup, timeout or connection failure occurs during
  external ingestion, the system shall offer bounded automatic recovery.
- When a web ingestion attempt exceeds sixty seconds, the system shall cancel
  that attempt and classify it as temporary unavailability.
- When public TikTok extraction succeeds with the verified updated extractor,
  the system shall download usable audio through the existing transcription flow.

### State-driven

- While an external ingestion job waits for recovery, the system shall retain
  its identity and show it as queued without a terminal access-block error.

### Unwanted behavior

- If the recovery budget is exhausted, then the system shall stop automatic
  retries and display an actionable temporary-unavailability message.
- If a source returns a permanent refusal, unavailable content, an unsafe URL
  or invalid media, then the system shall preserve its permanent classification.
- If subtitle requests are temporarily unavailable, then the system shall retain
  the existing fallback to audio transcription.

## Acceptance criteria

- [x] Frozen worker dependencies include the verified stable TikTok extractor.
- [x] Tests distinguish web 408/429/5xx, temporary DNS and transport failures
      from 403/404, invalid DNS names and unsafe hosts.
- [x] Seconds, HTTP-date, invalid and excessive Retry-After values are tested.
- [x] A nonresponding web fetch is cancelled at its total attempt deadline.
- [x] Official TikTok API and media failures retain temporary status and retry
      hints without weakening official-host, byte or redirect limits.
- [x] Long cooldowns and exhausted temporary retries produce a lease-fenced
      queued transition, safe diagnostics and bounded terminal failure.
- [x] Subtitle fallback, cancellation and transcript checkpoint behavior pass
      existing regression tests.
- [ ] Production deployment and reprocessing validate the reported failed item.
- [ ] Security checks verify the refreshed network and document dependencies.
- [ ] The combined-image smoke check verifies local-volume storage and restart.

## Out of scope

Private or removed content, bypassing source restrictions, new proxy services,
unrelated feature updates, database schema changes and historical bulk retries.

## Decisions

The owner authorized implementation, delivery, deployment and reprocessing.
Existing durable queue behavior is reused; no new retry scheduler is introduced.
Long waits release the worker slot instead of delaying unrelated ingestion.

> 2026-10-05: Include compatible security updates required by the delivery scans
> for existing network and document-processing dependencies.
>
> 2026-10-05: Align the combined-image smoke check with default local storage
> after the optional object-store registry rejected unauthenticated image pulls.
