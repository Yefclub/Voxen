# Spec 205 — Re-ingest an existing source in place

## Context

Submitting an X URL that already has an active transcript returns that
transcript instead of re-ingesting it (spec 201 dedupe). When the stored
content is wrong — a model answer that denied access, a changed or deleted
post, or any retrieval failure — there is no way to fix it in place:
regenerating the summary re-reads the same stored text, and the source refresh
route is gated to web pages. Spec 204 now fails X ingestion when nothing is
retrievable, which surfaces the failure without giving the reader a retry.

Web pages already have a refresh path that versions the source content,
invalidates dependent artifacts, and re-runs enrichment. This spec generalizes
that contract to X posts, so a reprocess replaces the canonical content of the
same transcript.

## Glossary

- **Reprocess**: re-run retrieval and analysis for a transcript that already
  exists, replacing its canonical content.
- **Refresh state**: the per-transcript status (`CHECKING`, `CURRENT`,
  `FAILED`) and error message shown to the reader.
- **Source version**: the numbered snapshot of canonical content kept when it
  changes.
- **Derivatives**: summary, flow, tags, citations, note anchors, and Brain
  compilation derived from the canonical content.

## Requirements

### Ubiquitous

- The system shall expose a reprocess action bound to an existing transcript
  instead of creating a second job for the same URL.
- The system shall keep the transcript id, workspace, and creation metadata
  unchanged.
- The system shall preserve the previous canonical content in the source
  version history before replacing it.
- The system shall expose refresh state and error message on the transcript.
- The system shall leave the existing web refresh path unchanged.

### Event-driven

- When the reader triggers reprocess for an X transcript, the system shall
  queue one ingestion job bound to that transcript.
- When the reprocessed content differs from the stored content, the system
  shall replace the canonical content, reset summary, flow, and tags,
  invalidate reviewable derivatives, and re-run enrichment.
- When the reprocessed content is identical to the stored content, the system
  shall complete without rewriting content, bumping the source version, or
  re-running enrichment.
- When retrieval fails, the system shall fail the job and mark the transcript
  refresh state as failed with the public message.
- When a reprocess for the transcript is already queued or running, the system
  shall refuse another request.

### State-driven

- While a reprocess is running, the transcript shall report `CHECKING` until
  the job finishes.

### Unwanted behavior

- If the transcript does not exist, belongs to another user, or is trashed,
  then the system shall refuse the request without queuing a job.
- If the job fails, then the stored content and its version history shall
  remain unchanged.

## Acceptance criteria

- [x] Reprocessing an X transcript updates the same transcript with the new
      content and source version 2.
- [x] The previous content remains available in the source version history.
- [x] Summary, flow, and tags are reset and re-generated from the new content.
- [x] Identical content completes without a version bump or enrichment.
- [x] A failed retrieval keeps the stored content and marks the refresh state
      as failed with the public message.
- [x] A second reprocess while one is active is refused with 409.
- [x] The web refresh behaviour and its tests are unchanged.
- [x] Tests cover the unchanged path, the replace path, and the refusal paths.

## Out of scope

- Automatic or scheduled reprocessing.
- Reprocessing other sources beyond the existing web refresh.
- New transcription methods or schema changes.
