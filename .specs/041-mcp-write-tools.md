# 041 — Tools de escrita no MCP

## Contexto

A spec 037 modernizou o MCP (SDK oficial + Streamable HTTP) mantendo-o somente-leitura.
O pedido original do owner inclui o MCP **criar informações** e **solicitar transcrições**
— ou seja, agentes externos (Claude Desktop, Cursor, etc.) poderem escrever na KB e
disparar ingestão, não só consultar.

## Escopo

Adicionar tools de escrita ao servidor MCP, reusando a lógica já existente da web
(criação de nota + enfileiramento de job), com annotations honestas e isolamento por
`userId`.

## Requisitos

### R1 — Criar/editar nota

- WHEN o agente chama `voxen_create_note(title, content?)` THEN o servidor SHALL criar
  uma nota (kind=NOTE) do usuário do token, reindexar o Brain e retornar `{id, title}`.
- WHEN chama `voxen_update_note(note_id, title?, content?)` THEN SHALL atualizar a nota
  (validando que é NOTE do próprio usuário); sem título/conteúdo → erro acionável.
- Annotations: `create` = `readOnlyHint:false, destructiveHint:false` (aditivo);
  `update` = `destructiveHint:true, idempotentHint:true` (sobrescreve).

### R2 — Solicitar transcrição + status

- WHEN o agente chama `voxen_request_transcription(url)` THEN o servidor SHALL enfileirar
  o job reusando `createAutoJobForUser` e retornar `{outcome, jobId?, transcriptId?, message}`:
  - `created` → jobId; `existing_transcript` → transcriptId; `inflight` → jobId; `invalid`/
    `setup_incomplete` → `isError` com mensagem.
- WHEN chama `voxen_get_job_status(job_id)` THEN SHALL retornar `{id, status, transcriptId, error}`
  (status QUEUED/RUNNING/DONE/FAILED/CANCELLED); DONE → transcriptId pra ler depois.
- Annotations: `request_transcription` = `readOnlyHint:false, openWorldHint:true` (busca URL
  externa); `get_job_status` = read-only.

### R3 — Isolamento e segurança

- WHEN qualquer write tool roda THEN SHALL escopar por `userId` do token (note create/update,
  job enqueue e status são do próprio usuário; nunca de input do cliente).
- WHEN o cliente passa um note_id/job_id de outro usuário THEN a tool SHALL retornar não-encontrado.

### R4 — Documentação para agentes

- WHEN o cliente faz `initialize` THEN as `instructions` SHALL incluir o fluxo de escrita.
- WHEN o admin copia o prompt em `/admin/integracoes` THEN ele SHALL listar as write tools e
  não afirmar mais "somente-leitura".

## Fora de escopo

- Upload de arquivo binário via MCP (ingestão de texto cobre o caso via create_note).
- Deletar nota/transcrição via MCP (mutação destrutiva forte fica fora por ora).
- Confirmação humana (HITL) no nível do MCP — o cliente decide via annotations.

## Critérios de aceite

- [ ] `tools/list` inclui as 4 write tools com annotations corretas (readOnlyHint false).
- [ ] `voxen_create_note` cria nota escopada por userId — coberto por teste.
- [ ] `voxen_request_transcription` reusa o enfileiramento real e devolve outcome/jobId.
- [ ] Prompt do admin + instructions atualizados (sem "somente-leitura").
- [ ] typecheck, lint, prettier, `bun test` e build verdes.
