# 008 — Automações (jobs periódicos com continuidade no chat)

**Status**: rascunho — aguardando aprovação do owner
**Autor**: Yef (Carlos Kalyel)
**Data**: 2026-05-18
**Relacionado**: spec 003 (chat-agno), PR T (Telegram bot), feat de notas

## Contexto e motivação

Hoje o user opera o Voxen reativamente (transcreve quando quer, conversa
quando quer). A feature de automações permite que a Vox trabalhe pra ele
em background: gerar resumos periódicos do que ele andou consumindo,
pesquisar tópicos na web e criar notas automaticamente, e entregar
resultados via Telegram quando ele não estiver na app.

A continuidade é crítica: se a Vox envia um resumo às segundas 9h e o
user, na quarta, pergunta no /chat "esclarece o ponto 3 daquele resumo",
a IA precisa conseguir puxar o output da automação como contexto. A
estratégia escolhida é **página /automacoes própria + tool de leitura no
agente** — a IA chama `list_automation_runs()` quando o user referenciar
uma automação, em vez de poluir a conversa principal com runs
automatizados.

## Decisões

- **Runs vivem em página própria `/automacoes`**, não na lista de
  conversas. Cada automação tem um histórico de runs renderizado como
  cards expansíveis.
- **Agendamento por presets visuais** (diário / semanal / mensal +
  HH:MM). Sem cron syntax. Timezone derivado de `User.timezone` (já
  existente) — fallback `America/Sao_Paulo`.
- **Scheduler no worker** via ARQ cron job que roda a cada 60s,
  varre `Automation WHERE status='ACTIVE' AND nextRunAt <= NOW()`,
  enfileira `process_automation_run(run_id)`.
- **Execução via chat service HTTP interno**: o worker chama `/chat`
  (endpoint existente) passando o `prompt` da automação como mensagem
  user, recebe a resposta completa (não-stream), salva em `outputMd`.
  Reusa stack atual (OR + tools + custos).
- **Delivery channel** opcional: `IN_APP` (padrão), `TELEGRAM` (envia
  output via bot existente), `BOTH`. Telegram só funciona se user tem
  `telegramChatId` linkado.
- **Sem custom prompt no MVP** — só 2 tipos `PERIODIC_SUMMARY` e
  `WEB_RESEARCH`. Cada tipo monta um system prompt específico do
  template.
- **Manual trigger** via botão "Rodar agora" — útil pra testar antes do
  agendamento + ad-hoc.
- **Tool no agente Agno**: `list_automation_runs(automation_id?, limit=5)`
  retorna runs recentes (id, automation_name, startedAt, outputMd
  truncado) com escopo `userId`.

## Modelo de dados

```prisma
enum AutomationType {
  PERIODIC_SUMMARY  // resumo do período (puxa transcrições/notas via tools)
  WEB_RESEARCH      // pesquisa web sobre um tema e cria nota
}

enum AutomationFrequency {
  DAILY
  WEEKLY
  MONTHLY
}

enum AutomationStatus {
  ACTIVE
  PAUSED
}

enum AutomationDelivery {
  IN_APP
  TELEGRAM
  BOTH
}

enum AutomationRunStatus {
  PENDING
  RUNNING
  SUCCESS
  FAILED
}

model Automation {
  id          String              @id @default(cuid())
  userId      String
  name        String              // ex: "Resumo semanal de transcrições"
  type        AutomationType
  prompt      String              // texto base que vai pro modelo
  frequency   AutomationFrequency
  hour        Int                 // 0-23 (timezone do user)
  minute      Int                 // 0-59
  dayOfWeek   Int?                // 0=segunda..6=domingo (WEEKLY)
  dayOfMonth  Int?                // 1-31 (MONTHLY, clamped p/ último dia)
  delivery    AutomationDelivery  @default(IN_APP)
  status      AutomationStatus    @default(ACTIVE)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  user        User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs        AutomationRun[]

  @@index([userId])
  @@index([status, nextRunAt])  // scheduler hot path
}

model AutomationRun {
  id            String              @id @default(cuid())
  automationId  String
  userId        String              // duplicado p/ scoping rápido
  status        AutomationRunStatus @default(PENDING)
  startedAt     DateTime?
  finishedAt    DateTime?
  outputMd      String?
  errorMessage  String?
  tokensIn      Int                 @default(0)
  tokensOut     Int                 @default(0)
  costUsd       Decimal             @default(0) @db.Decimal(12, 6)
  noteId        String?             // se WEB_RESEARCH criou nota
  telegramSent  Boolean             @default(false)
  createdAt     DateTime            @default(now())

  automation    Automation @relation(fields: [automationId], references: [id], onDelete: Cascade)
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([automationId, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
}
```

## Requisitos (EARS)

### REQ-1 — CRUD de automações
**WHEN** o user envia `POST /api/automations` autenticado
**THE SYSTEM SHALL** validar payload (nome, tipo, freq, hora, prompt
não-vazios), calcular `nextRunAt` baseado no timezone do user, criar
registro e retornar 201.

**WHEN** o user chama `GET /api/automations`
**THE SYSTEM SHALL** retornar todas as automações do `userId` corrente
com contagem de runs e último status.

**WHEN** o user chama `PATCH/DELETE /api/automations/:id`
**THE SYSTEM SHALL** validar ownership (WHERE userId=:uid) antes de
modificar/deletar.

### REQ-2 — Cálculo de próxima execução
**WHEN** uma automação é criada ou um run completa
**THE SYSTEM SHALL** calcular `nextRunAt` como o próximo timestamp UTC
em que `(hora, minuto, dia_da_semana|dia_do_mês)` casa, respeitando o
timezone do user. Para `MONTHLY` com `dayOfMonth=31`, fazer clamp para o
último dia do mês corrente.

### REQ-3 — Scheduler
**WHEN** o worker ARQ executa o cron `automation_scheduler_tick` (a cada
60s)
**THE SYSTEM SHALL** consultar `Automation WHERE status='ACTIVE' AND
nextRunAt <= NOW()`, criar um `AutomationRun status=PENDING` pra cada,
atualizar `lastRunAt=NOW()` + `nextRunAt=<próximo>`, enfileirar job
`process_automation_run(run_id)`.

### REQ-4 — Execução de run
**WHEN** o worker pega `process_automation_run(run_id)`
**THE SYSTEM SHALL**:
1. UPDATE run SET status=RUNNING, startedAt=NOW()
2. Montar `messages` com system prompt do tipo + prompt do user
3. Chamar `POST chat:8001/chat` (non-streaming via header
   `X-Voxen-Stream: 0` — novo flag a adicionar) com user_id do owner
4. Coletar resposta completa + custos + tools usadas
5. Se tipo=`WEB_RESEARCH` e a IA chamou `create_note`, salvar `noteId`
6. UPDATE run SET status=SUCCESS, outputMd=<resposta>, finishedAt=NOW(),
   tokens/cost
7. Disparar delivery (Telegram) se aplicável

### REQ-5 — Falha de execução
**IF** qualquer etapa do REQ-4 lança exceção
**THEN THE SYSTEM SHALL** UPDATE run SET status=FAILED,
errorMessage=<msg>, finishedAt=NOW(); não retentar automaticamente.

### REQ-6 — Delivery Telegram
**WHEN** run completa com sucesso e
`automation.delivery IN (TELEGRAM, BOTH)`
**AND** o user tem `telegramChatId` linkado
**THE SYSTEM SHALL** enviar o `outputMd` (truncado em 4000 chars com
`...` se exceder) via bot Telegram e marcar `run.telegramSent=true`.

**IF** o user NÃO tem `telegramChatId`
**THEN THE SYSTEM SHALL** registrar warning no log e seguir (não falha
a run).

### REQ-7 — Trigger manual
**WHEN** o user chama `POST /api/automations/:id/run`
**THE SYSTEM SHALL** validar ownership, criar `AutomationRun
status=PENDING`, enfileirar `process_automation_run` e retornar
`{ runId }` em 202. NÃO atualiza `lastRunAt` nem recalcula `nextRunAt`
(trigger manual não desloca o cronograma).

### REQ-8 — Listagem e detalhe de runs
**WHEN** o user chama `GET /api/automations/:id/runs?limit=20`
**THE SYSTEM SHALL** retornar runs ordenadas `createdAt DESC` com escopo
`userId`.

**WHEN** o user chama `GET /api/automations/runs/:runId`
**THE SYSTEM SHALL** retornar o run completo (incluindo `outputMd`) com
escopo `userId`.

### REQ-9 — Tool no agente
**WHEN** a IA chama `list_automation_runs(automation_id?, limit=5)`
**THE SYSTEM SHALL** retornar JSON com runs recentes do user
(automação, status, startedAt, outputMd truncado em 2000 chars).
**IF** `automation_id` é passado **AND** não pertence ao user
**THEN** retornar `{ error: "automation not found" }`.

### REQ-10 — UI: página /automacoes
**WHEN** o user navega para `/automacoes`
**THE SYSTEM SHALL** mostrar:
- Botão "Nova automação" (top-right)
- Lista de cards com: nome, tipo, freq formatada
  ("toda segunda às 09:00"), status (ativo/pausado), última run
  (timestamp + ok/erro), botões Editar / Rodar agora / Pausar
- Se vazio: empty state com CTA

### REQ-11 — UI: formulário nova/editar
**WHEN** o user abre formulário
**THE SYSTEM SHALL** apresentar campos:
- Nome (input)
- Tipo (radio: Resumo periódico / Pesquisa web)
- Prompt (textarea, com placeholders/exemplos por tipo)
- Frequência (dropdown: Diária / Semanal / Mensal)
- Se semanal: dropdown dia da semana
- Se mensal: input dia (1-31, clamp visual)
- Hora (HH:MM picker)
- Entrega (radio: na app / Telegram / ambos) — opção Telegram
  desabilitada com tooltip se user não linkou Telegram
- Submit cria/atualiza + recalcula `nextRunAt`

### REQ-12 — UI: detalhe da automação
**WHEN** o user clica num card
**THE SYSTEM SHALL** abrir `/automacoes/:id` com:
- Header: nome + freq + próxima execução
- Botões: Rodar agora / Editar / Pausar/Retomar / Deletar
- Lista de runs (cards expansíveis) com status colorido + markdown do
  `outputMd` em accordion

### REQ-13 — Isolamento por user
**THE SYSTEM SHALL** garantir que toda query de automação e run tenha
`WHERE userId = :currentUser`. Worker e chat service nunca aceitam
`automation_id` ou `run_id` sem cruzar `userId`.

## Critérios de aceite (testes a escrever)

- [ ] Schema + migration idempotente aplicada
- [ ] `nextRunAt` calculado corretamente p/ DAILY/WEEKLY/MONTHLY em SP
      (testes com fake time)
- [ ] Scheduler tick processa só ACTIVE com `nextRunAt <= NOW()`
- [ ] Manual trigger não desloca `nextRunAt`
- [ ] Run FAILED quando chat service retorna erro
- [ ] Telegram só envia se user tem `telegramChatId`; truncamento ok
- [ ] Tool `list_automation_runs` escopada por user
- [ ] CRUD respeita ownership (404 em automação de outro user)
- [ ] UI: form valida campos; muda input dia/semana conforme freq

## Fora de escopo (follow-ups)

- Custom prompt arbitrário (3o tipo)
- Retry automático em falha
- Notificação in-app quando run completa (toast global)
- Templates pré-prontos ("Resumo do que você transcreveu essa semana")
  — fica como sugestão clicável no form, mas não bloqueia
- Histórico de modificações de uma automação
- Exportar resultado de run pra arquivo
- Recorrência em múltiplos dias da semana (ex: seg+qua+sex)

## Estimativa de esforço

Feature grande mas coesa. ~1000-1300 LOC distribuídas:
- Schema + migration: ~80 LOC
- Routes Node (CRUD + runs): ~250 LOC
- UI (lista + form + detalhe): ~450 LOC
- Worker (scheduler + process_run + delivery): ~300 LOC
- Tool no agente: ~50 LOC
- Testes: ~250 LOC

Bate todos os 13 REQs numa PR só. Se ficar grande demais durante a
implementação, quebrar em 2: (a) backend completo, (b) UI.
