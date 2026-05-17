# Spec 003 — Chat com Agente sobre o Acervo

## Contexto

O Voxen permite **conversar com o acervo** via agente que usa tools determinísticas (abordagem Karpathy/harness — sem embeddings). O agente roda no `apps/chat` (Python + FastAPI), chama o OpenRouter usando o modelo `default_chat_model` configurado no setup, e tem acesso a 5 tools que leem do Postgres + Garage do user logado.

Sem RAG vetorial. Sem chunking. Sem embeddings. Tools simples, determinísticas, escopadas por `userId`.

Referências: ADR-004 (no embeddings), `docs/TRANSCRIPT-FORMAT.md`, Spec 000 (settings cifrados), Spec 002 (transcripts).

## Tools disponíveis ao agente

| Nome | Parâmetros | Retorna |
|---|---|---|
| `list_transcripts` | (limit?, source?) | array de `{id, title, channel, durationSec, source, createdAt}` |
| `search_transcripts` | (query, limit?) | array de `{id, title, snippet, rank}` via Postgres FTS |
| `read_transcript` | (transcript_id) | markdown completo do .md no Garage |
| `read_transcript_section` | (transcript_id, from_sec, to_sec) | recorte do markdown entre dois timestamps |
| `get_metadata` | (transcript_id) | frontmatter JSON |

Todas as tools recebem `userId` injetado pelo handler — agente nunca decide escopo.

## Requisitos

### Ubiquitous

- The system shall scope every tool call to the authenticated `userId`.
- The system shall use `Settings.GLOBAL.default_chat_model` as the model, decrypted via master key.
- The system shall stream the agent response token-by-token via SSE.
- The system shall record one `CostEvent` per chat call with `kind=CHAT`, model, tokens in/out, cost.

### Event-driven

- **When** the user sends a message to `POST /api/chat` with `{messages: [...]}`, the system shall forward to `chat:8001/chat` with `X-Voxen-User-Id: <userId>` and stream the response back via SSE.
- **When** the agent emits a tool call, the system shall execute the tool, append the result to the conversation, and continue until the model returns a final text response (max 5 tool-call loops).
- **When** the agent finishes, the system shall publish a final `done` SSE event and insert the CostEvent.

### State-driven

- **While** setup is not complete (no `openrouter_api_key`), the system shall reject chat with HTTP 412.
- **While** the user has `monthlyBudgetUsd` set AND the running-total exceeds it, the system shall reject with HTTP 402.

### Unwanted

- **If** the user is not authenticated, the system shall return HTTP 401.
- **If** the model returns 401/403 from OpenRouter, the system shall surface as `error` SSE event with admin-action message.
- **If** a tool execution fails, the system shall append `{error: "..."}` as the tool result and continue the loop.

## Critérios de Aceite

- [ ] `POST /api/chat` autenticado → SSE com tokens em tempo real
- [ ] Tool `search_transcripts` retorna resultados via FTS escopado pelo `userId`
- [ ] Tool `read_transcript` busca .md do Garage do user correto
- [ ] CostEvent registrado após cada resposta completa
- [ ] UI `/chat` renderiza mensagens (user + assistant + tool calls coletados) com streaming visual
- [ ] Mensagens persistem em DB (`Conversation` + `ChatMessage`) — atualizado pós-PR #33

## Fora de Escopo (atual)

- Multimodalidade na entrada do agente (só texto/voz-transcrita; chat não recebe imagens)
- Re-ranking ou pós-processamento dos resultados FTS
- Streaming bidirecional (websocket) — atualmente SSE one-way

## Revisão pós-implementação (2026-05-17)

Spec original lista alguns "fora do escopo" que foram implementados em PRs
subsequentes. Esta seção reflete o estado atual:

### Tools (7 total — eram 5 no MVP)

1. `list_transcripts(workspace_id)` — list metadata
2. `search_transcripts(workspace_id, query)` — Postgres FTS com snippets
3. `read_transcript(id)` — markdown completo
4. `read_transcript_section(id, from_ts, to_ts)` — recorte por timestamp
5. `get_metadata(id)` — frontmatter JSON
6. **`read_transcript_summary(id)`** — adicionada em PR #33; lê summaryMd
   (gerado pelo worker via chat service no fim do pipeline)
7. **`transcribe_video(url)`** — adicionada em PR #33; agente dispara Job de
   transcrição diretamente. Suporta YouTube/Instagram/TikTok (PR #45)
8. **`scrape_url(url)`** — adicionada em PR #39; agente indexa página web via
   Trafilatura

### Persistência de conversas (PR #33)

Migration `20260517170000_conversations` adicionou:
- `Conversation` (id, userId, title, thinking, archivedAt, timestamps)
- `ChatMessage` (id, conversationId, role: USER|ASSISTANT, content, tools jsonb)
- Index `Conversation(userId, updatedAt desc)` + `ChatMessage(conversationId, createdAt)`

Endpoints: GET/POST/PATCH/DELETE `/api/chat/conversations` + `/conversations/:id/send`
faz proxy SSE pro chat service e persiste a resposta no fim do stream.

### Voz como input (PR #33)

- `MediaRecorder` no browser → POST `/api/chat/voice` (form-data)
- Web proxa pro chat service `/voice-transcribe` → OpenRouter Whisper
- Texto retornado vai pro input do chat (user confirma antes de enviar)
- Limites: 25 MB cap, allowlist MIME, rate 30/h (PR #49)

### Thinking toggle (PR #33)

- Boolean `Conversation.thinking` persiste preferência por conversa
- Quando true, chat service envia `extra_body.reasoning.effort = "medium"`
  pra OpenRouter (suportado por modelos como Gemini 2.5 Pro/Flash, Claude 3.7)

### Resumo IA do transcript (PR #33)

- Worker (após persistir Transcript) chama chat service `/summarize-transcript`
  best-effort (não bloqueia o Job)
- Endpoint `POST /api/transcripts/:id/summary` permite regenerar manual
- Anti-loop UI: throttle 1/min + flag `{ force: true }` se já existe (PR #49)

## Histórico

- 2026-05-17: spec rascunhada e implementada no mesmo PR (chat-agno, PR #33).
- 2026-05-17: extensões (histórico DB, voz, thinking, summary, transcribe_video,
  read_transcript_summary, scrape_url) implementadas nas PRs #33, #39, #45, #49.
  Spec atualizada aqui (PR docs/specs-transcript-format).
