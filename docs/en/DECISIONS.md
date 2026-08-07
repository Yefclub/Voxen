# Architecture Decision Records — Voxen

This English document is the default ADR index for contributors. The
Portuguese file preserves the detailed historical log while decisions are
progressively migrated; new public repository decisions must be documented in
English first.

## ADR-001: Electron to Web

Voxen started as an Electron desktop application with a Python sidecar for local transcription. The project moved to a self-hosted web platform because desktop packaging, CUDA requirements, sharing, and multi-user collaboration were too costly for the product direction.

Consequences:

- Docker Compose became the primary installation path.
- Transcription moved to OpenRouter instead of local WhisperX.
- Multi-user operation and admin approval became first-class.

## ADR-002: pnpm Workspace + Makefile

The repo has TypeScript and Python apps. Turbo and similar tools fit TypeScript better than mixed TS/Python orchestration, so Voxen uses pnpm workspaces for TypeScript and `uv` per Python app, with the root Makefile as the shared command surface.

## ADR-003: Separate Python Agent (superseded)

The first web architecture selected a separate Python agent service. That
decision was superseded when the agent moved into `apps/web` using AI SDK 7 and
the OpenRouter provider. The integrated runtime removes an internal HTTP hop,
shares authenticated `userId` scoping with the Hono API, and preserves the
deterministic harness approach.

## ADR-004: Postgres FTS Instead of pgvector

Voxen uses the harness approach: agents navigate deterministic tools over plain data instead of relying on vector embeddings. Postgres full-text search is the search engine.

Benefits:

- no embedding pipeline
- no embedding reindex cost
- readable and inspectable search behavior
- simpler deployment

Tradeoff:

- semantic queries without matching terms can be weaker than vector search
- very large corpora may require future optimization

## ADR-005: ARQ Instead of BullMQ (superseded)

The worker needs Python-native media extraction and ffmpeg integration. ARQ was
originally selected, but it was never used by the runtime. The current worker
uses durable Postgres `Job` rows, `FOR UPDATE SKIP LOCKED`, and renewable leases.
Redis Pub/Sub is only an ephemeral wakeup and realtime transport.

## ADR-006: Local-Volume Default with Optional S3

Canonical Markdown and media remain outside PostgreSQL behind provider-neutral
storage keys. New single-host installs use one shared persistent volume mounted
at `/data/storage`; S3-compatible storage is an explicit option for external or
multi-host deployments. Existing non-empty `S3_*`/`GARAGE_*` configuration is
inferred as S3 when no driver was previously recorded, so an upgrade cannot
silently expose an empty local library. Driver changes never migrate data.

## ADR-007: Better Auth with Admin Approval

Voxen is multi-user but intentionally restricted. The first user becomes the admin; later users are pending until approved.

## ADR-008: `MASTER_KEY` from Environment

Application secrets stored in the database are encrypted with a master key from `MASTER_KEY`. The key must be backed up with Postgres and object storage.

## ADR-009: Separate Agent Stream Client (superseded)

The original separate agent required a custom stream bridge. The current
integrated agent emits the application's SSE event contract directly from the
authenticated Hono route and persists text, reasoning, sources, and tool events
as ordered message segments.
