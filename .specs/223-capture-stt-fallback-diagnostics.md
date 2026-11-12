# Spec 223 — Capture STT fallback and safe partial-failure diagnostics

## Context

Live diagnosis on 2026-11-12 found a capture published without speech and a
YouTube capture published without video frames. The current STT chain puts
Gemini before the local WAV-only sidecar. Link capture chooses MP3 whenever
the first entry is a cloud provider, so the configured local fallback is
silently excluded from transcription. Partial failures keep their warning
but lose the cause needed for operational diagnosis.

The owner authorized the necessary tests, fixes, delivery to dev and deploy.
This spec amends spec 221's first-entry audio-format rule. Provider order,
configured providers, source-access restrictions and media bounds remain
the existing contract.

## Requirements

### Ubiquitous

- The system shall preserve the user's configured STT provider order.
- The system shall retain the existing MP3 fallback for unknown duration or
  audio longer than one hour, and shall never send non-WAV chunks to local STT.
- The system shall retain cancellation, lease fencing, retry behavior,
  publication of usable partial content and accounting for every AI attempt.

### Event-driven

- When any usable entry in the STT chain is local, the system shall request
  WAV before extracting audio, including when cloud providers precede local.
- When a preceding cloud STT entry fails and the extracted audio is WAV, the
  system shall try the configured local entry for the whole audio.
- When a step publishes a partial-failure warning, the system shall emit a
  structured diagnostic with the capture and owner identifiers, step, warning
  and stable capture error code; typed AI failures shall additionally include
  the known provider and valid HTTP status when available.

### Unwanted behavior

- If no local entry is available or configured, then the system shall keep
  requesting MP3.
- If frame extraction returns no usable frames, then the system shall report
  a `frames_unavailable` warning with a `NO_TEXT` diagnostic code.
- If an upstream failure contains credentials, request data or response text,
  then the diagnostic shall omit those values and include only bounded,
  allowlisted metadata.
- If cancellation or lease loss occurs during a step, then the system shall
  stop without emitting a partial-failure warning for that step.

## Acceptance criteria

- [x] A cloud-first chain containing available local STT requests WAV and
      recovers through local STT when the cloud entry fails.
- [x] Cloud-only and unavailable-local chains request MP3.
- [x] The MP3 compatibility guard and duration/size limits remain covered.
- [x] Speech, frame extraction and vision warnings emit safe diagnostics;
      empty frame results receive `NO_TEXT`.
- [x] Cancellation emits no misleading partial-failure diagnostic and creates
      no document.
- [x] Targeted regressions and the required repository checks pass.
- [ ] After deploy, the affected sources are tested again through the capture
      pipeline without duplicating or discarding their existing documents;
      any remaining platform block or provider rejection is reported with
      observed evidence.

## Out of scope

Login/cookie-based extraction, bypassing source restrictions, reordering or
adding providers, UI changes, a new public error format and schema migrations.

> 2026-11-12: Authorized by the owner as the repair of the observed capture
> failures; no additional approval gate is required for this scoped delivery.
