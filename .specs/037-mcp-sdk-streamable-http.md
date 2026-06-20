# 037 — MCP modernizado: SDK oficial + Streamable HTTP

## Contexto

O servidor MCP do Voxen (`apps/web/src/routes/mcp.ts`) era um JSON-RPC 2.0 escrito
à mão, com transporte HTTP POST simples, `protocolVersion: "2024-11-05"`, tools de
1 linha de descrição, sem annotations, sem structured output e com `isError`
detectado de forma frágil. Funcionava por sorte com clientes tolerantes, mas não é
o padrão que clientes reais (Claude Desktop, Cursor) esperam.

Esta spec moderniza a **base** do MCP para o padrão de mercado (pesquisa em
`docs/` / fontes primárias do protocolo). Tools de **escrita** ficam para a spec
seguinte (038); aqui o servidor segue **somente-leitura**.

## Decisão

- Adotar o SDK oficial `@modelcontextprotocol/sdk` + `@hono/mcp`
  (`StreamableHTTPTransport`), spec **2025-11-25**.
- **Stateless por request**: um `McpServer` + transport são criados por request,
  com as tools fechando sobre o `userId` autenticado. `enableJsonResponse` (sem SSE
  por request) — nossas tools são request/response.
- Manter a auth atual (Bearer `mcp_api_token` = `<userId>:<token>`, cifrado,
  comparação constant-time, user `APPROVED`), agora como guarda antes do transporte.

## Requisitos

### R1 — Transporte e protocolo

- WHEN um cliente MCP conecta em `/mcp` THEN o servidor SHALL falar Streamable HTTP
  via o SDK oficial e negociar `protocolVersion` 2025-11-25.
- WHEN há header `Origin` que não bate com `APP_BASE_URL` THEN o servidor SHALL
  responder 403 (defesa de DNS rebinding); sem `Origin` (cliente não-browser) passa.
- WHEN o Bearer token é ausente/inválido/usuário não-`APPROVED` THEN SHALL 401/403
  antes de qualquer processamento MCP.

### R2 — Tools (read-only) com qualidade de mercado

- WHEN o cliente chama `tools/list` THEN as tools SHALL ter nomes com prefixo
  `voxen_` (snake_case), descrições ricas (quando-usar + exemplos) e annotations
  `readOnlyHint: true` + `openWorldHint: false`.
- WHEN uma tool retorna dados THEN SHALL devolver `structuredContent` tipado +
  um bloco de texto (compat), com `outputSchema` declarado nas tools de conteúdo.
- WHEN um input é inválido ou o recurso não existe THEN a tool SHALL retornar
  `isError: true` com mensagem acionável (não erro de protocolo).
- WHEN as listagens são grandes THEN `voxen_list_transcripts`/`voxen_list_notes`
  SHALL paginar por cursor opaco (`nextCursor`).
- Tools: `voxen_search_transcripts`, `voxen_read_transcript`,
  `voxen_list_transcripts`, `voxen_search_notes`, `voxen_read_note`,
  `voxen_list_notes`, `voxen_brain_search`, `voxen_brain_neighbors`,
  `voxen_brain_sources`, `voxen_brain_path`.

### R3 — Explicação para qualquer agente

- WHEN o cliente faz `initialize` THEN o servidor SHALL devolver `instructions`
  explicando o que é o Voxen, o fluxo buscar→ler e as regras de uso.
- WHEN o admin copia o prompt em `/admin/integracoes` THEN ele SHALL refletir os
  nomes `voxen_*`, o transporte Streamable HTTP e a configuração do cliente.

### R4 — Isolamento

- WHEN qualquer tool roda THEN todas as queries SHALL ser escopadas pelo `userId`
  do token (nunca de input do cliente).

## Fora de escopo

- Tools de escrita (criar nota, solicitar transcrição, ingestão) → spec 038.
- OAuth 2.1 (auth é OPCIONAL no MCP; bearer estático → userId é suficiente para
  self-hosted single-tenant).
- Resources/Prompts MCP e a primitiva experimental Tasks.

## Critérios de aceite

- [ ] `tools/list` sem initialize prévio funciona (stateless); `initialize` negocia
      2025-11-25; `tools/call` devolve `structuredContent`.
- [ ] Tools `voxen_*` com `readOnlyHint`; erros via `isError`.
- [ ] Auth Bearer + Origin validados; queries escopadas por `userId`.
- [ ] Prompt do admin atualizado; typecheck, lint, testes e build verdes.
