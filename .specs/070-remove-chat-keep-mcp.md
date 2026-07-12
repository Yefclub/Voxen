# Spec 070 — Remover chat in-app e Telegram; manter MCP

## Status

Implementado (slice 1)

## Contexto

O Voxen tinha três interfaces de agente:

1. Chat in-app (`/chat` + SSE via `apps/chat` + proxy `/api/chat`)
2. Bot Telegram (long-polling em `apps/chat`)
3. MCP server (`/mcp` no `apps/web`)

Decisão do owner: **remover completamente** o chat in-app e o Telegram. O **MCP** passa a ser a única interface de agente sobre o acervo.

Dependência crítica: o pipeline de resumo (`summaryMd`) do worker chamava `CHAT_SERVICE_URL/summarize-transcript`. Remover `apps/chat` sem migrar o resumo quebraria summaries automáticos e o botão de regenerar resumo na biblioteca.

## Requisitos (EARS)

### Ubiquitous

- O sistema DEVE manter o endpoint MCP Streamable HTTP em `/mcp` com auth Bearer via `mcp_api_token`.
- O sistema DEVE gerar resumos de Transcript (`summaryMd` + `CostEvent`) no **worker** via OpenRouter direto, sem HTTP para serviço de chat.
- O sistema DEVE gerar/regenerar resumo sob demanda em `POST /api/transcripts/:id/summary` no **web**, também via OpenRouter direto (mesmo prompt/comportamento).

### Event-driven

- QUANDO um job de mídia/web conclui e persiste Transcript, o worker DEVE tentar `summary.maybe_generate` best-effort (falha não falha o job).
- QUANDO o admin/user remove o serviço de chat, o health deep do web NÃO DEVE checar um serviço `chat`.

### Unwanted

- O sistema NÃO DEVE expor rotas `/api/chat/*` nem páginas `/chat` ou `/chat/:id`.
- O sistema NÃO DEVE renderizar chat flutuante na página de detalhe de transcrição.
- O sistema NÃO DEVE expor UI/API de bot Telegram (admin token, link de conta, delivery TELEGRAM em automações).
- O sistema NÃO DEVE incluir serviço `chat` no `docker-compose.yml` / override / imagem Easypanel / workflows CI de build de `apps/chat`.

### State-driven

- ENQUANTO o runtime de automação (ex-Agno em `apps/chat`) não for reimplementado, `process_run` DEVE marcar runs como `FAILED` com mensagem clara apontando MCP.
- Tabelas Prisma `Conversation`, `ChatMessage`, `TelegramLink` PODEM permanecer no schema nesta PR (sem migration drop) para reduzir risco; código de aplicação NÃO DEVE usá-las.

## Escopo

### Incluído

- Migrar `summarize-transcript` → worker (`summary.py` + OpenRouter)
- Migrar regeneração de resumo no web (`lib/transcript-summary.ts`)
- Remover UI/rotas de chat e floating transcript chat
- Remover Telegram (bot, settings, account linking, delivery)
- Remover `apps/chat` do tree, compose, Dockerfile, entrypoint, Makefile, CI
- Spec e testes do summary/worker ajustados
- MCP intacto

### Fora / follow-up

- Reimplementar runtime de automações (PERIODIC_SUMMARY / WEB_RESEARCH) sem `apps/chat`
- Migration SQL para drop de `Conversation` / `ChatMessage` / `TelegramLink` / enums TELEGRAM
- Limpeza completa de chaves i18n mortas (`chat.*`, `account.telegram.*`, etc.)
- Atualizar branch protection no GitHub (remover required checks `Lint Python (apps/chat)` / `Test Python (apps/chat)` se ainda listados)
- Docs longas (`docs/ARCHITECTURE.md`, etc.) podem ser atualizadas em PR docs

## Aceite

- [ ] Worker gera summary sem `CHAT_SERVICE_URL`
- [ ] `POST /api/transcripts/:id/summary` funciona sem serviço chat
- [ ] `/mcp` autentica e lista tools (testes existentes)
- [ ] Navegação sem item/rota de chat
- [ ] Compose sobe sem serviço `chat`
- [ ] Testes worker summary + suite web relevante passam sem docker
