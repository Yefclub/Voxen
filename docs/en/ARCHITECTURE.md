# Architecture — Voxen

Voxen is a self-hosted knowledge platform with two application services and
two required infrastructure services. Docker Compose provides the reference
deployment; the combined `voxen` image is the recommended Easypanel path.

## System Overview

```text
Browser
  |
  v
apps/web (Bun + Hono + React + AI SDK)
  |---- Postgres 17 (Prisma, FTS, graph data, users, jobs, settings)
  |---- Redis 7 (wakeup, realtime, cache, rate limits)
  |---- shared local volume (default) or S3-compatible storage
  `---- apps/worker (Python asyncio + durable Postgres job leases)
```

The web application is the only public edge service. The worker has no public
HTTP port. Redis accelerates delivery, but Postgres remains the durable source
of truth for jobs and application state.

## `apps/web`

The Bun service serves the React SPA and the Hono API. It owns:

- Better Auth email/password sessions and optional OIDC SSO;
- first-run onboarding, user approval, and administrator controls;
- transcript, note, graph, automation, MCP, and cost APIs;
- integrated agentic chat with AI SDK 7 and OpenRouter;
- deterministic, user-scoped retrieval over Postgres FTS, graph relations,
  and provider-neutral transcript storage;
- SSE streaming of text, reasoning, tool calls, and progress;
- encrypted global platform settings and per-user account integrations.

Administrator configuration lives under `/admin/*`. User-owned profile,
platform-account, and MCP controls live under `/conta/*`. Every user-owned
query derives `userId` from the authenticated session, never from request
input.

## `apps/worker`

The Python worker claims durable jobs from Postgres with
`FOR UPDATE SKIP LOCKED`. Each attempt owns a renewable lease; expired leases
are requeued or failed after the retry limit. Redis Pub/Sub only wakes workers
and delivers realtime progress, so a lost notification cannot lose a job.

Main ingestion flow:

1. Validate job metadata and the source URL.
2. Prefer official captions when available.
3. Extract and segment media when transcription is required.
4. Send supported inputs to the administrator-configured OpenRouter models.
5. Build the canonical Markdown transcript and derived metadata.
6. Write artifacts through the selected local or S3 storage driver.
7. Mirror searchable text, authorship, source, tags, and relationships in
   Postgres.
8. Mark the content ready only after all required stages have reached a
   terminal state.

## Main Flows

### First Setup

1. The first account becomes the approved administrator.
2. The administrator completes onboarding and configures OpenRouter.
3. Voxen validates the account and applies the canonical model slots.
4. Subsequent users inherit platform model configuration and retain isolated
   personal data and account sessions.

### New User and SSO

Local accounts start pending until an administrator approves them. An
administrator may also configure an OIDC provider, restrict allowed domains,
and choose whether trusted SSO users are approved automatically.

### Chat

1. The web app persists the authenticated user's message.
2. FTS and graph hints preload compact candidate context.
3. The agent verifies relevant evidence with progressive retrieval tools.
4. Current facts can use web search; configured X research uses its dedicated
   model slot.
5. New supported URLs can enqueue ingestion and await its final result.
6. Text, reasoning, sources, and tool events stream over SSE and are persisted
   as chronological segments.
7. Reload restores the timeline; stored reasoning is not fed back into model
   context.

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
  incompatible nonterminal work instead of allowing it to be reclaimed.

## Design Direction

Voxen favors inspectable infrastructure and deterministic tools over opaque
retrieval layers. Knowledge-graph relations complement full-text search; they
do not replace evidence-backed source retrieval.
