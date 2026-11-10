# Architecture — Voxen

Voxen is a self-hosted knowledge platform with one application service, one
optional capture service, and two required infrastructure services. Docker
Compose provides the reference deployment; the combined `voxen` image is the
recommended Easypanel path, with `capture-worker` added as a second service
when link capture is wanted.

## System Overview

```text
Browser
  |
  v
apps/web (Bun + Hono + React)
  |---- Postgres 17 (Prisma, FTS, graph data, users, jobs, settings)
  |---- Redis 7 (wakeup, realtime, cache, rate limits)
  |---- shared local volume (default) or S3-compatible storage
  |---- OpenAI / Anthropic / OpenRouter / xAI / Gemini (fixed endpoints, per-user keys)
  `---- capture-worker (internal network, bearer token)
          `---- Smokescreen egress proxy ---> public internet only
```

The web application owns every database, storage, and provider call. Capture
jobs, knowledge deletions, and retained maintenance run in the web process
with durable Postgres leases. The capture worker only downloads and converts
media; it holds no `MASTER_KEY`, provider key, or database credential. Redis
accelerates delivery, but Postgres remains the durable source of truth for jobs
and application state.

## `apps/web`

The Bun service serves the React SPA and the Hono API. It owns:

- Better Auth email/password sessions and optional OIDC SSO;
- first-run onboarding, user approval, and administrator controls;
- library read, note, graph, MCP, and account APIs;
- deterministic, user-scoped retrieval over Postgres FTS, graph relations,
  and provider-neutral transcript storage;
- SSE streaming of text, reasoning, tool calls, and progress;
- encrypted global platform settings and per-user account integrations.

Administrator configuration lives under `/admin/*`. User-owned profile,
platform-account, and MCP controls live under `/conta/*`. Every user-owned
query derives `userId` from the authenticated session, never from request
input.

## Background jobs

Knowledge deletions (`DELETE_KNOWLEDGE`) and captures (`CAPTURE_LINK`,
`CAPTURE_UPLOAD`) run in the web process with `FOR UPDATE SKIP LOCKED`
claims, heartbeat leases, and a 3-attempt budget with backoff for transient
errors. Expired leases are reclaimed by the startup drain and the periodic
interval, so a restart resumes work instead of losing it.

## `capture-worker` (spec 220)

A separate container runs yt-dlp, Deno, ffmpeg/ffprobe (unmodified BtbN
`linux64-lgpl` build, used only as a separate binary), and Trafilatura. It
publishes no ports, accepts only requests carrying `CAPTURE_WORKER_TOKEN`, runs
as a non-root user on a read-only root filesystem with all capabilities
dropped and `no-new-privileges`, and sends every outbound request through
Smokescreen, which denies private, loopback, link-local, and metadata ranges
after DNS resolution and redirects.

The web app reaches it at `CAPTURE_WORKER_URL`. When the worker is missing or
unreachable, the knowledge base keeps working and capture jobs end with
`WORKER_UNAVAILABLE` after their retries.

## Capture flow

1. A user submits a link (`POST /api/captures`), a file
   (`POST /api/captures/upload`), or a PWA share (`POST /share-target`). The
   submit checks run synchronously and in order: URL shape and literal private
   addresses, an active capture of the same URL, the same URL already in the
   library (offers reprocessing instead), and a configured text model role.
   Only then is a job created.
2. The runner asks the worker for text first (captions, post, page, or
   document text). Speech-to-text runs only when no usable text exists and the
   source has audio; up to four images are described when the text is short
   and a vision role exists. The worker result is stored as a capture artifact
   so a retry skips the download.
3. One structured model call with no tools and no web search produces title,
   summary, key points, tags, and entities from the captured content, which is
   passed as untrusted data.
4. The document is published through the internal publication contract
   version 2 (`DOCUMENT`) into the same storage, index, and graph as prepared
   content. Reprocessing updates the same document in place and keeps the
   previous text as a source version.
5. Progress events (`extracting`, `transcribing`, `describing_images`,
   `interpreting`, `publishing`) are persisted and streamed over SSE with
   `Last-Event-ID` replay. Cancel, retry (same row, attempt reset), and
   reprocess are available from `/capturar` and the document page.

Provider keys are per user, encrypted with `MASTER_KEY`, and used only against
the fixed endpoints of OpenAI, Anthropic, OpenRouter, xAI, and Gemini. Each
role (fast, standard, vision, STT) has an ordered chain of up to 4 models: when
one fails, the next is tried (spec 221). Every failure
carries a stable code (`AI_NOT_CONFIGURED`, `LOGIN_REQUIRED`, `NO_TEXT`, …),
a localized message, and a suggested next action.

## Main Flows

### First Setup

1. The first account becomes the approved administrator.
2. The administrator completes onboarding with instance language and timezone —
   no provider account, key, or model.
3. Subsequent users inherit the platform configuration and retain isolated
   personal data and account sessions.

### New User and SSO

Local accounts start pending until an administrator approves them. An
administrator may also configure an OIDC provider, restrict allowed domains,
and choose whether trusted SSO users are approved automatically.

### Retrieval (no integrated chat)

1. MCP clients or the library query the base with deterministic FTS.
   Titles carry weight A and body/tags/folder weight B in transcripts (tag and
   folder names enter through subqueries, refreshed on link/move/rename);
   notes use title A and body B; ordered by score then identity; highlighted
   snippets ignore weights. Markdown headings enter the index as body text
   (weight B) with no new column; a title-like boost for headings stays
   deferred without a measured benefit.
2. Progressive reads return structure (outline) first, then narrow passages
   (lines/section/time range), with signed cursors and response budgets.
3. Graph relations complement text search with anchored evidence.
4. Claims are verified against stored canonical content; without evidence the
   system reports its absence instead of synthesizing an answer.

## Data and Storage

- Postgres: durable relational state, sessions, FTS, graph relations, job
  leases, and cost events.
- Redis: ephemeral wakeups, realtime events, operational cache, and rate
  limits.
- Storage: canonical Markdown and media artifacts in a shared local volume by
  default, or an explicitly selected S3-compatible backend. Logical keys are
  identical across drivers and switching drivers does not migrate data.

Tag-backed folders are virtual many-to-many memberships. A transcript keeps a
primary folder while tag-folder relations make the same content discoverable
without duplication.

## Authored annotations and derived external context

- A note may retain verified transcript anchors. Each anchor stores line/time
  bounds, the selected quote, and exact source version. Source refresh marks a
  mismatch stale instead of silently relocating it.
- Post-summary research is a separate durable enrichment. It never mutates
  canonical Markdown or `summaryMd`, treats source/web text as untrusted data,
  and is stored as `SUGGESTED` with structured URL citations.
- Research separates a tool-free planning pass from bounded search passes.
  Application validation sits between them, and the tool-enabled request never
  receives the raw transcript, summary, title, or planner rationale.
- Only fresh `READY + ACCEPTED` enrichments enter default retrieval and Brain,
  explicitly typed as lower-authority external derivatives. Dismissal,
  deletion, expiry, or source changes remove only their derivatives.
- The administrator selects `OFF`, `MANUAL`, or `AUTO`; `OFF` is fail-closed.
  Web and MCP requests share the same user-scoped durable queue as automatic
  post-summary research. Policy changes and inactive parent content cancel
  incompatible nonterminal work instead of allowing it to be reclaimed. Queue
  and claim read policy under the settings transaction lock; parent
  deactivation cancels work inside the lifecycle transaction itself. Every
  enqueue also locks the transcript row through creation, closing the race
  between enqueue, archive, and immediate restore.

## Design Direction

Voxen favors inspectable infrastructure and deterministic tools over opaque
retrieval layers. Knowledge-graph relations complement full-text search; they
do not replace evidence-backed source retrieval.
