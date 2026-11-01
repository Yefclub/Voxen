# Spec 215 — Remove Product 2 and built-in AI execution

## Context

Voxen narrows to Product 1: a self-hosted knowledge base that stores prepared content and serves it over MCP. Capture and interpretation of source material (Product 2) moves out. The baseline is `dev` at `95524cf`. This spec defines the removal boundary so Product 1 keeps working with no model-provider account, key, or inference.

## Glossary

- Product 1: storage, validation, deterministic indexing, retrieval, evidence, revisions, auth, maintenance.
- Product 2: agentic chat (routing, tool runtime, reconciliation, HITL approvals, UI/API), OpenRouter and other model clients, model selection, capability checks, fallback models, provider credentials/settings, model-cost UI, provider-dependent onboarding, built-in embedding inference and semantic-rescue execution, Mem0 conversational-memory integration, URL capture and source interpretation (web scraping, platform downloads, captions acquisition, transcription, OCR/vision/document analysis, recapture/freshness, media pipelines), platform cookies, extension flows, proxy/tunnel helpers, saved-media download/processing controls, automatic ingestion schedules, automatic titles/summaries/tags/diagrams/research artifacts, model-based Brain entity/claim/relation extraction and compilation scheduling, plus corresponding background jobs, startup hooks, MCP tools, REST routes, client controls, dependencies, build stages, CI jobs, settings, and docs existing only for the removed functionality.
- Prepared content: externally produced text/Markdown, sections, assets, summaries, tags, relations supplied with provenance.

## Requirements

### Ubiquitous

- The system shall start, schedule maintenance, serve reads/writes/retrieval with zero built-in model calls.
- The system shall preserve existing knowledge: documents, notes, URLs, timestamps, stored summaries/tags, assets, revisions, annotations, evidence-backed relations.
- The system shall keep owner-scoped auth, user admin, MCP OAuth/tokens, budgets, concurrency, signed cursors, revision safety.
- The system shall keep direct prepared-content writes, export, backup/restore, indexing, deletion/GC functional.
- The system shall keep historical migrations intact and use forward migrations for schema changes.

### Event-driven

- When a fresh install runs onboarding without any provider key, the system shall complete setup and enable knowledge use.
- When stored summary/tags are missing on read, the system shall return stored values only and never trigger inference.
- When a retained maintenance task (e.g. knowledge deletion) runs, the system shall execute it without the analysis worker and recover after restart.
- When Product 2 tables are retired, the system shall export/archive retired records (e.g. chat history) before dropping tables.
- When outstanding Product 2 jobs exist at upgrade, the system shall cancel or migrate them explicitly with no permanently queued work.

### State-driven

- While Product 1 operates, the system shall expose no Product 2 entrypoint in the active MCP catalog, REST API, UI, startup routines, or job dispatch.
- While dependencies are pruned, the system shall retain no disabled-but-executable legacy AI/capture subsystem in images or CI.

### Optional

- Where Redis remains useful for coordination, cache, rate-limit, or auth, the system shall keep it; removal is not required by this spec.

### Inventory

- The system shall publish a dependency inventory of routes, MCP tools, tables, jobs, settings, startup hooks, packages, and UI flows covered by the Product 2 boundary before each removal PR merges.

### Unwanted behavior

- If a request targets a removed Product 2 route, tool, job type, or setting, then the system shall reject it with an explicit unavailable/removed error, not silent success.
- If canonical stored content is missing on a read that previously fell back to reconstruction, then the system shall report unavailable source explicitly instead of returning fabricated structure.
- If a migration drops a table, then the system shall not silently delete stored knowledge assets or accepted derived material.

## Acceptance criteria

- [ ] Fresh install completes onboarding and uses the base with no provider account/key/model config.
- [ ] Startup, maintenance, reads, writes, retrieval perform no AI/model calls; missing summaries/tags never trigger inference.
- [ ] Dependency inventory is published and each removal is verifiable (static check plus MCP catalog plus image/CI check).
- [ ] Product 2 entrypoints are gone from MCP catalog, API, UI, startup, dispatch.
- [ ] Provider/model/capture/analysis deps and build layers are removed; no dormant executable subsystem.
- [ ] Prepared-content ingest, search, progressive reads, revisions, citations, graph, export, backup/restore work.
- [ ] Deletions and retained maintenance recover after restart without the worker.
- [ ] Upgrade tests cover preserved IDs/links/versions/annotations/relations/assets and outstanding jobs.
- [ ] MCP modern/legacy conformance, owner isolation, OAuth/scopes, budgets, concurrency, credential safety remain covered.
- [ ] Docker/Compose, CI, onboarding, docs describe the knowledge-base-only boundary.

References: Fixes #894. Companion spec 216 defines the prepared-content contract.

## Out of scope

- Building the replacement external analyzer or integrating OpenBot/agent-desktop.
- Rewriting Voxen or changing the Bun/Hono/PostgreSQL foundation.
- Mandatory vector DB or replacement search service.

## Risks / Open decisions

- Worker also performs Product 1 deletions today; needs a lightweight executor before worker removal.
- `isSetupComplete` depends on OpenRouter key; replacement readiness signal TBD (onboarding flag).
- Chat-history archive format and retention policy before table drops.
