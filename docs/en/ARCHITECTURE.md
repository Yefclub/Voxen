# Architecture — Voxen

Voxen is a self-hosted knowledge platform with one application service and
two required infrastructure services. Docker Compose provides the reference
deployment; the combined `voxen` image is the recommended Easypanel path.

## System Overview

```text
Browser
  |
  v
apps/web (Bun + Hono + React)
  |---- Postgres 17 (Prisma, FTS, graph data, users, jobs, settings)
  |---- Redis 7 (wakeup, realtime, cache, rate limits)
  `---- shared local volume (default) or S3-compatible storage
```

The web application is the only service. Retained maintenance (knowledge
deletions) runs in the web process itself with durable Postgres leases. Redis
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

## Retained maintenance (no worker)

There is no separate worker. Knowledge deletions (`DELETE_KNOWLEDGE`) run in
the web process itself (`knowledge-deletion-executor`), with `FOR UPDATE
SKIP LOCKED` claims, heartbeat leases, and a 3-attempt budget. Expired leases
are reclaimed by the startup drain and the periodic interval. Prepared content
arrives through versioned HTTP/MCP contracts; Voxen never runs models,
transcription, or scraping.

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
   Titles carry weight A and body weight B (same scheme for notes and
   transcripts), ordered by score then identity; highlighted snippets ignore
   weights.
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
