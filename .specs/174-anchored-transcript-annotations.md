# Spec 174 — Transcript-anchored annotations

## Context

Notes can reference transcripts but cannot preserve the exact passage that
supports an annotation. This feature extends the existing transcript-note
relationship without creating a separate comment system and without breaking
legacy unanchored links.

## Requirements

### Ubiquitous

- The system shall allow zero or more anchors per note, each attached to a
  transcript owned by the same user.
- The system shall store start/end lines, start/end times, selected quote,
  source checksum/version, and anchor status.
- The system shall preserve existing notes and unanchored transcript links.
- The system shall index the note as authored content and use the anchored
  passage only as provenance without mutating the transcript.

### Event-driven

- When a user selects text or a time range, the system shall allow creation of
  a note with a normalized and verified passage.
- When an anchored annotation is opened, the system shall navigate to and
  highlight its line or time range.
- When a source version changes and the quote no longer matches, the system
  shall mark the anchor stale without silently relocating it.
- When an anchor is removed, the system shall remove only derived anchor
  provenance and preserve the transcript and other note sources.

### State-driven

- While an anchor is valid, the system shall expose a navigable URL and its
  line/time range through the web and MCP APIs.
- While text selection is unavailable, the system shall allow creation through
  a manual form and the current content time.

### Unwanted behavior

- If any referenced identifier belongs to another user, then the system shall
  respond as though it does not exist.
- If ranges are negative, reversed, or incompatible with the source, then the
  system shall reject the operation without partial persistence.
- If the quote does not match the declared source version, then the system
  shall not persist the anchor as valid.

## Acceptance criteria

- [x] The migration adds anchors without losing existing transcript-note links.
- [x] Desktop and mobile UI can create, list, navigate, and highlight anchors.
- [x] Web APIs and MCP create, update, and list anchors while preserving legacy
  inputs.
- [x] MCP READ/WRITE scopes and destructive annotations are correct.
- [x] Source refresh explicitly marks affected anchors stale.
- [x] Retrieval and Brain preserve provenance without duplicating knowledge.
- [x] Tests cover validation, staleness, isolation, and derived cleanup.

## Out of scope

- Comment threads, mentions, or real-time collaboration.
- Writing comments into canonical transcript Markdown.
