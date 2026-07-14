# Spec 093 — Listagem temporal do acervo no agente

## Contexto

Perguntas como “resuma minha semana” / “principais achados desta semana” falham porque as tools do chat só buscam por termo (FTS/ILIKE). O schema já tem `Transcript.createdAt` e `Note.createdAt`. Esta spec adiciona listagens com janela de data para o agente in-app.

## Glossário

- **Intake**: itens adicionados ao acervo no Voxen (`createdAt`), não a data de publicação da fonte.
- **since / until**: limites ISO-8601 inclusivo/exclusivo da janela (`createdAt >= since` e, se `until`, `createdAt < until`).

## Requisitos

### Ubiquitous

- The system shall expose `list_transcripts` and `list_notes` tools on the in-app agent (`buildTools`).
- The system shall scope both tools by the current `userId` and only return ACTIVE transcripts / NOTE kind notes (folders excluded from note list for weekly summaries).
- The system shall order results by `createdAt` descending.

### Event-driven

- When the agent calls `list_transcripts` with optional `since`/`until`/`limit`, the system shall return `{ id, title, source, createdAt, summary?, tags[] }` for matching rows.
- When the agent calls `list_notes` with optional `since`/`until`/`limit`, the system shall return `{ id, title, createdAt, updatedAt }` for matching NOTE rows.
- When neither `since` nor `until` is provided, the system shall list the most recent items (default limit 30, max 100) — same as “recent intake”.

### Unwanted behavior

- If `since`/`until` is not a valid ISO datetime, then the tool shall return a clear error object (no throw to the model stream).
- If `until` is before `since`, then the tool shall return a clear error object.
- If the client tries to pass another user’s id, then the system shall ignore it (userId only from session).

### Agent instructions

- The system shall instruct the agent: for temporal intake questions (“esta semana”, “últimos N dias”, “o que entrou recentemente”), prefer `list_transcripts` / `list_notes` with `since`/`until` before keyword search; then outline/read a few items and summarize with citations.

## Critérios de Aceite

- [ ] Tools exist in `buildTools` with zod schemas for `since`/`until`/`limit`.
- [ ] Unit/source tests cover schema presence + date filter query shape (or execute with mocked db if feasible).
- [ ] AGENT_INSTRUCTIONS mention temporal listing.
- [ ] UI tool labels already exist (`tools.list_transcripts` / `tools.list_notes`); icons mapped in `chat-tools.ts`.
- [ ] Asking “resuma minha semana” no chat can list this week’s intake without requiring keyword terms.

## Fora de Escopo

- Changing MCP `voxen_list_*` (optional follow-up).
- Filtering by `publishedAt` of the source.
- Embeddings / calendar UI.
- Auto-creating the weekly note without HITL.

## Riscos / Decisões

- “Semana” is resolved by the model (ISO since/until); we do not hardcode timezone — instruct to use the user’s implied local week when possible, defaulting to last 7 days UTC if unclear.
