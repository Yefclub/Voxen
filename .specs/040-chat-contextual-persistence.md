# 040 — Chat contextual persistente por transcrição

## Contexto

O chat contextual da página de transcrição já criava uma Conversation real e
persistia mensagens, MAS: (1) o frontend perdia o `conversationId` no reload (criava
conversa nova órfã toda vez); (2) não havia FK ligando a conversa à transcrição, então
não dava pra reabrir "a conversa daquela transcrição"; (3) o painel usava `max-h` sem
`min-h`, colapsando e parecendo achatado. Feedback do owner: o chat deve ser contínuo,
virar seção no chat principal, e continuar após recarregar a página.

## Escopo

- Vincular cada conversa contextual à sua transcrição (FK opcional).
- Reabrir e carregar o histórico da conversa da transcrição no load (continuidade).
- Painel com altura decente (sem achatar).
- FAB de chat com cara moderna (circular, logo).

## Requisitos

### R1 — Persistência/continuidade

- WHEN o usuário conversa numa transcrição THEN a Conversation criada SHALL gravar
  `transcriptId` (após validar ownership da transcrição no backend).
- WHEN a página de detalhe da transcrição carrega THEN o chat SHALL reabrir a conversa
  existente daquela transcrição (`GET /conversations?transcriptId=`) e carregar suas
  mensagens — sobrevivendo ao reload.
- WHEN a conversa contextual existe THEN ela SHALL aparecer também na lista do chat
  principal (é uma Conversation normal).
- WHEN a transcrição é deletada THEN a conversa SHALL sobreviver com `transcriptId`
  nulo (FK `ON DELETE SET NULL`).

### R2 — Painel

- WHEN o chat contextual abre THEN o painel SHALL ter altura decente e estável
  (`h-[72dvh]` mobile, `h-[640px]`/`max-h-[85vh]` desktop) — sem colapsar.

### R3 — FAB

- WHEN a transcrição é aberta THEN o gatilho do chat SHALL ser um botão flutuante
  circular moderno com a logo do Voxen.

### R4 — Segurança/isolamento

- WHEN o backend vincula `transcriptId` THEN SHALL validar que a transcrição pertence
  ao usuário; transcrição de outro usuário SHALL ser ignorada (`transcriptId` nulo).
- Todas as queries de conversa permanecem escopadas por `userId`.

## Migração

- `Conversation.transcriptId TEXT NULL` + índice `(userId, transcriptId)` + FK
  `ON DELETE SET NULL`. Migration idempotente (`IF NOT EXISTS` / guard de constraint).

## Fora de escopo

- Múltiplas conversas por transcrição com seletor (resume sempre a mais recente).
- Mudar o serviço de chat (Python) ou o streaming.

## Critérios de aceite

- [ ] Reabrir a transcrição mostra o histórico do chat anterior (sobrevive reload).
- [ ] A conversa aparece na lista do `/chat`.
- [ ] Painel não fica achatado.
- [ ] Ownership do `transcriptId` validado — coberto por teste.
- [ ] typecheck, lint, prettier, `bun test` e build verdes; migration aplicada no CI.
