# Architecture — Voxen

Voxen is a self-hosted web platform made of three application services and three infrastructure services, deployed through Docker Compose.

## System Overview

```text
Browser
  |
  v
apps/web (Bun + Hono + React)
  |---- Postgres 17 (Prisma, FTS, users, sessions, transcripts, jobs, settings)
  |---- Redis 7 (queue, cache, rate-limit)
  |---- apps/chat (Python + FastAPI + Agno agent)
  |---- apps/worker (Python + ARQ + media extraction + ffmpeg)
                 |
                 v
             MinIO / S3-compatible storage
```

## `apps/web`

`apps/web` is the only public edge service. It serves the React SPA, exposes the Hono API, handles auth, and proxies authenticated chat streams.

Responsibilities:

- Better Auth email/password flow
- first-run onboarding and setup
- admin approval workflow
- jobs API
- transcript listing and rendering
- chat proxy to `apps/chat`
- settings stored in encrypted global settings

## `apps/chat`

`apps/chat` is an internal Python FastAPI service. It runs the Agno agent and streams responses back to the web app.

The agent uses deterministic tools instead of embedding search:

- list transcripts for a workspace
- search transcripts using Postgres full-text search
- read a transcript from S3-compatible storage
- read transcript sections by timestamp
- inspect transcript metadata

## `apps/worker`

`apps/worker` consumes background jobs through Redis and ARQ.

Main job flow:

1. Load job metadata from Postgres.
2. Validate the source URL with an allowlist.
3. Prefer official captions when available.
4. Download and segment audio when transcription is needed.
5. Send audio chunks to OpenRouter.
6. Build the canonical Markdown transcript.
7. Upload the transcript to S3-compatible storage.
8. Mirror searchable text and metadata in Postgres.
9. Update job status and cost events.

## Infrastructure

Postgres stores durable relational data and full-text search vectors. Redis backs the queue and operational caches. MinIO or another S3-compatible store keeps Markdown transcripts and media artifacts.

## Main Flows

### First Setup

1. The first account is created.
2. The backend detects there are no users and approves it as admin.
3. The admin enters onboarding.
4. The admin adds the OpenRouter key; the backend validates the account and atomically applies the canonical model set.
5. Settings are saved in global encrypted settings.

### New User Signup

1. A user creates an account.
2. The account is created as pending.
3. An admin approves or rejects the user.
4. Approved users can access their workspace.

### Transcript Job

1. The web app creates a job.
2. The worker extracts or transcribes source content.
3. A Markdown transcript is written to storage.
4. Postgres receives mirrored plain text and metadata.
5. The UI shows job completion and the transcript becomes searchable.

### Chat

1. The user sends a question and the web app persists it.
2. Postgres FTS preloads compact title, summary, and tag suggestions.
3. The AI SDK agent confirms relevant context with progressive retrieval tools.
4. Current facts use `web_search`; X content uses `search_x` with the configured Grok model.
5. A new URL makes `request_transcription` wait for the worker and return a summary/tag/related brief.
6. Text, reasoning, and tool events stream through SSE and persist as chronological segments.
7. Reload restores that timeline, while stored reasoning is never fed back into model context.

Tag-backed folders are virtual many-to-many memberships: `Transcript.folderId`
remains the primary folder, while list and count operations also include
`TranscriptTag -> Tag.folderId` without duplicating content.

## Design Direction

Voxen favors simple, inspectable infrastructure over opaque managed systems. The most important architectural choice is the harness approach: agents use deterministic tools over plain data instead of a vector embedding pipeline.
