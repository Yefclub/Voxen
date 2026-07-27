# Spec 081 — Ferramenta de ingestão de URL para o agente in-app

## Status

Aprovado pelo owner (2026-07-12).

## Contexto

Bug relatado pelo owner: ao colar um link (YouTube/X/etc.) no chat, o agente respondeu que
"não tem acesso à internet" e não conseguia abrir links externos. Isso é falso — o Voxen É
uma plataforma que recebe links e os transcreve/indexa; o agente só não tinha a ferramenta
para fazer isso.

Causa raiz confirmada por leitura do código: `buildTools(userId)` em
`apps/web/src/lib/chat/runtime.ts` expunha 13 tools, todas de LEITURA sobre o que já está no
acervo (`search_transcripts`, `read_transcript`, etc.). Nenhuma tool de ingestão/enfileiramento
de URL nova. O servidor MCP (`apps/web/src/routes/mcp.ts`) já resolve esse mesmo problema para
agentes externos com `voxen_request_transcription` + `voxen_get_job_status`, ambas chamando
`createAutoJobForUser` (`apps/web/src/routes/jobs.ts`). Esta spec estende o agente in-app com o
par equivalente, reaproveitando a mesma função (sem duplicar lógica de criação de job).

Referências: `apps/web/src/routes/mcp.ts` (`registerWriteTools`), `apps/web/src/routes/jobs.ts`
(`createAutoJobForUser`), spec 074 (harness de recuperação progressiva — instructions do agente).

## Glossário

- **outcome**: resultado estruturado do enfileiramento — `created` (job novo),
  `existing_transcript` (URL já transcrita), `inflight` (já em processamento) ou `error`.
- **Job**: registro de processamento assíncrono (worker ARQ) de uma URL — status `QUEUED`,
  `RUNNING`, `DONE`, `FAILED` ou `CANCELLED`.

## Requisitos

### Ubiquitous

- The system shall expor duas tools novas em `buildTools(userId)`: `request_transcription` e
  `get_job_status`.
- The system shall reaproveitar `createAutoJobForUser` (`apps/web/src/routes/jobs.ts`) na
  implementação de `request_transcription`, sem duplicar a lógica de criação/dedupe de job.
- The system shall escopar toda consulta de job por `userId` vindo do fechamento de
  `buildTools`, nunca de input do modelo (isolamento de workspace).
- The system shall instruir o agente (`AGENT_INSTRUCTIONS`) a usar `request_transcription`
  quando uma URL compartilhada pelo usuário não aparecer em `search_transcripts`, e a nunca
  alegar falta de acesso à internet ou incapacidade de abrir links.
- The system shall manter intacto o fluxo progressivo de dez passos já existente em
  `AGENT_INSTRUCTIONS` (spec 074), apenas acrescentando a cobertura de ingestão.

### Event-driven

- When o modelo chama `request_transcription(url)` e a URL ainda não foi processada, the
  system shall enfileirar um job via `createAutoJobForUser` e retornar `outcome=created` com
  `jobId`.
- When a URL já foi transcrita anteriormente, the system shall retornar
  `outcome=existing_transcript` com `transcriptId`, sem criar job duplicado.
- When a URL já está em processamento (`QUEUED`/`RUNNING`), the system shall retornar
  `outcome=inflight` com o `jobId` existente.
- When `createAutoJobForUser` retornar `invalid` (URL inválida) ou `setup_incomplete`
  (configuração pendente), the system shall retornar `outcome=error` com a mensagem de erro
  já em PT-BR e sem detalhes internos (stack trace, SQL, etc.).
- When o modelo chama `get_job_status(jobId)` para um job existente do próprio usuário, the
  system shall retornar `status`, `transcriptId` e `error`.

### Unwanted behavior

- If o `jobId` consultado em `get_job_status` não existir OU pertencer a outro usuário, then
  the system shall retornar um erro genérico ("Job não encontrado.") sem vazar dados de outro
  workspace.
- If o agente receber um link compartilhado pelo usuário, then the system shall nunca alegar
  não ter acesso à internet ou não poder abrir links — essa afirmação é falsa no contexto do
  Voxen.

## Critérios de Aceite

- [x] `buildTools(userId)` expõe `request_transcription` e `get_job_status`.
- [x] `request_transcription` reutiliza `createAutoJobForUser` e cobre os quatro outcomes
      (`created`/`existing_transcript`/`inflight`/`error`).
- [x] `get_job_status` consulta `db.job.findFirst` escopado por `{ id, userId }` e retorna
      `status`/`transcriptId`/`error`.
- [x] `AGENT_INSTRUCTIONS` cobre o fluxo de ingestão sem remover os dez passos existentes do
      harness progressivo (spec 074).
- [x] Testes cobrindo os quatro outcomes de `request_transcription`, os status
      (`DONE`/`FAILED`/`QUEUED`/não encontrado) de `get_job_status`, e isolamento por `userId`
      em ambas as tools.
- [x] Lint, typecheck e testes TS (`bun test`) passam.

## Fora de Escopo

- Mudanças no servidor MCP — `voxen_request_transcription`/`voxen_get_job_status` já existem
  e não são alteradas por esta spec.
- Upload de arquivo via chat (fora do escopo — apenas URLs).
- Aumento de `stepCountIs` além de 12 — o fluxo de ingestão (enfileirar → informar, ou
  enfileirar → acompanhar) cabe no orçamento de steps já existente.

## Riscos / Decisões

- Nomes das tools sem prefixo `voxen_` — convenção já usada pelas demais tools do agente
  in-app, diferente do servidor MCP (que serve agentes externos).
- `outcome=error` agrega os casos `invalid` e `setup_incomplete` de `AutoJobResult` — ambas as
  mensagens já são PT-BR seguras para expor ao modelo (nenhuma contém detalhe interno).
- `stepCountIs` mantido em 12 (YAGNI): o fluxo de ingestão adiciona no máximo 2 passos
  (enfileirar + status) ao orçamento já usado pelo harness progressivo da spec 074.
