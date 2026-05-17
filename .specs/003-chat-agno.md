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
- [ ] Mensagens persistem na sessão atual (sem persistência em DB no MVP — só localStorage)

## Fora de Escopo

- Histórico de chats salvo no DB (MVP usa só sessão local)
- Multimodalidade (só texto)
- Function calling estruturado fora dos 5 tools acima
- Re-ranking ou pós-processamento dos resultados FTS

## Histórico

> 2026-05-17: spec rascunhada e implementada no mesmo PR (chat-agno).
