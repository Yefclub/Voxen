# Spec 180 — Saved media library

## Context

Some users need to preserve a remote video before deciding whether it belongs
in the knowledge base. Downloading and transcription are separate intents: a
saved item must remain private, durable, and downloadable without appearing in
retrieval, Graph, chat, or MCP until the user explicitly processes it.

## Requirements

### Ubiquitous

- The system shall scope every saved media record and storage key to the
  authenticated user.
- The system shall use the configured `local` or `s3` storage driver without
  exposing provider credentials or raw object keys to the browser.
- The system shall preserve the canonical source URL, title, author/channel,
  duration, MIME type, filename, byte size, status, error, and timestamps.
- The system shall stream downloads through an authenticated same-origin
  endpoint with HTTP range support.
- The system shall bound remote downloads by duration and byte size and reject
  unsupported URLs before queueing work.

### Event-driven

- When a user submits a supported video URL, the system shall create one saved
  media record and one durable `DOWNLOAD_MEDIA` job.
- When the worker finishes downloading, the item shall become `READY` and the
  queue trail shall expose probe, download, storage, and completion stages.
- When the user requests processing of a `READY` item, the system shall queue
  the existing upload transcription pipeline against the stored object rather
  than downloading the source again.
- When processing finishes, the saved item shall link to the resulting
  transcript and become `PROCESSED`.

### State-driven

- While an item is queued, downloading, or processing, destructive actions and
  duplicate processing shall be unavailable.
- While an item is ready, the user shall be able to download it or queue
  transcription.
- While an item is processed, the user shall be able to open both the stored
  media and the resulting transcript.
- While object deletion is in progress, the item shall remain recoverable and
  shall not be processable or retried as a download.
- When a linked transcript is permanently deleted, the system shall preserve
  the saved object and return its media record to `READY`.

### Unwanted behavior

- If another user requests a record or media stream, then the system shall
  return 404 without revealing its existence.
- If remote download, storage, or processing fails, then the system shall
  preserve an inspectable terminal state and never create a partial knowledge
  item.
- If a leased worker attempt fails or exhausts its retries, then the job and
  saved-media state shall transition atomically without allowing an older
  attempt to overwrite a newer retry.
- If deleting the storage object fails, then the database record shall remain
  retryable and the API shall not report successful deletion.
- If an item already has a persisted transcript, then deleting its stored media
  shall be rejected so the transcript's original-media link cannot be broken.
- If two requests race for the same user and canonical URL, then at most one
  active saved item shall be created.

## Acceptance criteria

- [x] A new `/downloads` page lists only the current user's saved media.
- [x] Supported URLs can be queued without entering the knowledge base.
- [x] Volume and S3 drivers both persist and stream the saved object.
- [x] The queue exposes durable download stages and terminal failures.
- [x] A ready item downloads to the user's machine with range support.
- [x] A ready item can be processed without fetching the remote source again.
- [x] Successful processing links the item to its transcript and knowledge
      surfaces only through that transcript.
- [x] User isolation, duplicate requests, bounds, retries, and lifecycle states
      have automated coverage.
- [x] Historical retries cannot regress ready/processing media or create a
      download job after its media relation was removed.
- [x] Every saved item remains reachable through paginated UI navigation.

## Rollback

- Removing the `/downloads` navigation and route disables new use without
  affecting existing transcripts.
- The migration is additive. Existing `SavedMedia` objects remain downloadable
  until intentionally removed; no rollback deletes stored media.

## Out of scope

- DRM-protected, private, paywalled, or playlist downloads.
- Automatic transcription immediately after download.
- Transcoding every source into one universal codec.
- Global storage quotas, retention billing, or automatic expiration.
