# Architecture Decision Records — Voxen

This document summarizes the major architectural decisions. The Portuguese file remains the canonical ADR log; this English mirror exists so contributors can understand the system without reading Portuguese.

## ADR-001: Electron to Web

Voxen started as an Electron desktop application with a Python sidecar for local transcription. The project moved to a self-hosted web platform because desktop packaging, CUDA requirements, sharing, and multi-user collaboration were too costly for the product direction.

Consequences:

- Docker Compose became the primary installation path.
- Transcription moved to OpenRouter instead of local WhisperX.
- Multi-user operation and admin approval became first-class.

## ADR-002: pnpm Workspace + Makefile

The repo has TypeScript and Python apps. Turbo and similar tools fit TypeScript better than mixed TS/Python orchestration, so Voxen uses pnpm workspaces for TypeScript and `uv` per Python app, with the root Makefile as the shared command surface.

## ADR-003: Agno for the Agent

Voxen uses Agno in `apps/chat` instead of a TypeScript-only agent stack. The tradeoff is one internal Python service, but it gives the project a stronger tool-calling and agent foundation.

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

## ADR-006: S3-Compatible Object Storage

Transcripts are Markdown files stored outside the database. Voxen uses S3-compatible storage with MinIO as the default local and Compose option. This keeps local, VPS, and Easypanel deployments aligned.

## ADR-007: Better Auth with Admin Approval

Voxen is multi-user but intentionally restricted. The first user becomes the admin; later users are pending until approved.

## ADR-008: `MASTER_KEY` from Environment

Application secrets stored in the database are encrypted with a master key from `MASTER_KEY`. The key must be backed up with Postgres and object storage.

## ADR-009: Custom SSE Client

Agno streaming does not use the Vercel AI SDK protocol. Voxen uses a small custom SSE client in the front-end instead of adding an adapter layer too early.
