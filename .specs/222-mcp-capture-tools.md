# Spec 222 — MCP capture tools

## Context

Specs 220 and 221 shipped link capture: a link is downloaded by the
`capture-worker`, interpreted with the owner's cloud AI chains and stored as a
document in the knowledge base. Today it can only be started from the web UI,
the REST API and the PWA share target. Spec 220 kept "MCP tools that start
captures" out of scope.

On 2026-11-10 the owner asked for MCP clients to send content to Voxen so it
is analyzed and attached to the knowledge base. Owner decisions (closed):

- M1. Links only. No file upload over MCP (base64 payloads are heavy in the
  protocol); uploads stay in the web UI.
- M2. Capture only. The automatic titles, summaries, tags and diagrams that
  spec 215 removed do not come back here.

This spec amends spec 220's out-of-scope list: MCP tools that start captures
are now in scope, limited to the tools below.

## Glossary

- Capture: a link-capture job of spec 220, owned by one user.
- Terminal status: `DONE`, `COMPLETED_WITH_WARNINGS`, `FAILED`, `CANCELLED`.

## Requirements

### Ubiquitous

- The system shall expose four MCP tools: `voxen_capture_url`,
  `voxen_capture_status`, `voxen_list_captures` and `voxen_cancel_capture`.
- The system shall require the `mcp:write` scope for `voxen_capture_url` and
  `voxen_cancel_capture`, and the `mcp:read` scope for `voxen_capture_status`
  and `voxen_list_captures`.
- The system shall derive the owner of every capture from the MCP token's
  user and never from tool arguments.
- The system shall run MCP captures through the same submission path as the
  web UI: the same URL validation, deduplication, AI-configured check, queue,
  pipeline and resulting document.
- The system shall return from `voxen_capture_url` without waiting for the
  capture to finish.
- The system shall report capture failures with the stable error codes of
  spec 220 and their localized message, never with raw worker or provider
  error text.
- The system shall annotate `voxen_capture_url` as not read-only, not
  destructive, not idempotent and open-world, and `voxen_cancel_capture` as
  not read-only, not destructive, idempotent and closed-world.

### Event-driven

- When `voxen_capture_url` receives a link that already has an active
  capture for the same user, the system shall return that capture with
  `deduped = true` instead of creating another.
- When `voxen_capture_url` receives a link already stored as a document for
  the same user, the system shall return that document's id and title with
  `existing = true` and create no capture.
- When `voxen_capture_url` creates a capture, the system shall return its id,
  status, platform and the instruction to poll `voxen_capture_status`.
- When `voxen_capture_status` is called for a capture in a terminal status
  with a document, the system shall return the document id and title so the
  client can read it with the existing reading tools.
- When `voxen_list_captures` is called, the system shall return the user's
  most recent captures, newest first, at most 50 per page (default 20), with
  an opaque cursor for the next page.
- When `voxen_cancel_capture` targets an active capture, the system shall
  cancel it exactly as the web UI does and return the updated capture.

### State-driven

- While the user has no text AI role configured, `voxen_capture_url` shall
  fail with `AI_NOT_CONFIGURED` and point to the AI settings page, unless the
  link already exists as a document.

### Unwanted behavior

- If the user exceeds 30 capture submissions in one minute (shared with the
  web UI and PWA), then `voxen_capture_url` shall fail with a rate-limit
  error and create no capture.
- If the link is invalid, unsupported or resolves to a blocked address, then
  `voxen_capture_url` shall fail with the corresponding spec 220 code.
- If a capture id does not exist or belongs to another user, then
  `voxen_capture_status` and `voxen_cancel_capture` shall answer
  "capture not found" without revealing whether the id exists.
- If `voxen_cancel_capture` targets a capture already in a terminal status,
  then the system shall return the capture unchanged and state that it had
  already finished.

## Acceptance criteria

- [x] A token with only `mcp:read` lists `voxen_capture_status` and
      `voxen_list_captures` but not the two write tools; calling a write tool
      returns `insufficient_scope`.
- [x] `voxen_capture_url` with a new valid link creates one `CAPTURE_LINK`
      job owned by the token's user and returns its id without waiting.
- [x] Submitting the same link while active returns the same id with
      `deduped = true`; submitting a stored link returns `existing = true`.
- [x] Missing AI config returns `AI_NOT_CONFIGURED`; invalid link returns
      `INVALID_URL`; the 31st submit in a minute is refused.
- [x] `voxen_capture_status` returns stage, percent, warnings, the public
      error code and, when finished, the document id and title.
- [x] Another user's capture id is "not found" on status and cancel.
- [x] `voxen_list_captures` paginates with a cursor and only shows the
      caller's captures.
- [x] `voxen_cancel_capture` cancels an active capture and leaves a finished
      one unchanged.
- [x] The MCP catalog conformance tests and tool-annotation policy cover the
      four tools.

## Out of scope

File upload over MCP, retry and reprocess over MCP, progress streaming or
MCP notifications, automatic titles/summaries/tags/diagrams (spec 215
removals), and changes to the capture pipeline itself.

## Risks / Open decisions

- An MCP client can spend the owner's AI provider budget. Mitigated by the
  `mcp:write` scope, the shared rate limit and the per-capture cost already
  recorded and shown by spec 220.

> 2026-11-10: Approved by the owner; implemented and verified against the MCP and capture integration suites.
