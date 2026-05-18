# 007 — Compactação automática de memória do chat

**Status**: aceita
**Autor**: Yef (Carlos Kalyel)
**Data**: 2026-05-18
**Relacionado**: spec 003 (chat-agno), ADR sobre custos OR

## Contexto e motivação

Conversas com a Vox crescem até estourar o limite de contexto do modelo
configurado. Quando isso acontece hoje, o OR retorna `400
context_length_exceeded` e a próxima resposta falha de forma opaca pro
usuário. Como o produto é self-hosted single-tenant, faz sentido replicar
o padrão do Claude Code / Codex / Orbital: **monitorar o uso do contexto
em tempo real e compactar automaticamente** quando se aproxima do limite,
substituindo as mensagens antigas por um resumo detalhado gerado pelo
próprio modelo.

A solução é deliberadamente simples (sem cache, sem heurísticas complexas
de relevância): conta tokens estimados, dispara em 70% do limite, pede
resumo, soft-deleta as mensagens antigas no DB.

## Decisões

- **Threshold default = 70% do limite do modelo**. Mais conservador que
  Claude Code (80%) porque o agente Voxen pode encadear até
  `MAX_TOOL_LOOPS=5` chamadas de ferramenta no mesmo turno (cada uma
  injeta tool result no histórico) + resposta em streaming. 30% de
  headroom evita estouro nesse cenário.
- **Estimativa de tokens = `len(content) // 4`**. Aproximação empírica
  comum (BPE em PT-BR/EN converge perto disso). Não vale precisão de
  tokenizer por modelo — o ganho não compensa a complexidade.
- **K=6 mensagens recentes preservadas**. Garante 3 trocas user+assistant
  imediatas sem perda de contexto crítico.
- **Soft-delete via `compactedAt` timestamp**. Mensagens originais não
  somem do DB — UI pode opcionalmente exibir via `?includeCompacted=1`.
- **Resumo como `ChatMessage role=SYSTEM kind=COMPACTION_SUMMARY`**. Vive
  na conversa como uma mensagem ativa, e o histórico que vai pro modelo
  passa a ser `[system_prompt, summary, ...últimas K]`.
- **Sem retry**: se a chamada de resumo falha, emite SSE
  `compaction_failed` e UI avisa. Próxima chamada pode estourar.

## Requisitos (EARS)

### REQ-1 — Monitoramento de uso
**WHEN** o usuário envia mensagem no chat
**THE SYSTEM SHALL** emitir um SSE event `context_usage` com
`{tokens: <estimativa>, limit: <limite do modelo>}` ANTES de qualquer
chamada ao OR.

### REQ-2 — Trigger de compactação
**WHEN** o total de tokens estimados das mensagens é maior ou igual a
`limite * 0.70`
**AND** existe `conversation_id` válido
**AND** há mais de 6 mensagens não-system
**THE SYSTEM SHALL** acionar o fluxo de compactação automaticamente.

### REQ-3 — Geração do resumo
**WHEN** o fluxo de compactação é acionado
**THE SYSTEM SHALL**:
1. separar `[system_msgs] + [old_msgs] + [recent_msgs]` (K=6 recentes)
2. chamar o mesmo modelo configurado com o `COMPACTION_PROMPT` enviando
   os `old_msgs` serializados
3. usar `stream=False` (resposta única)

### REQ-4 — Persistência
**WHEN** o modelo retorna um resumo não-vazio
**THE SYSTEM SHALL**, em uma única transação:
1. validar que `conversation_id` pertence a `user_id` (cruza `userId` no
   `SELECT FROM Conversation`); se não, lançar erro
2. inserir nova `ChatMessage` com `role=SYSTEM`, `kind=COMPACTION_SUMMARY`,
   `content=<resumo>`
3. marcar todas as `ChatMessage` anteriores da mesma conversa (exceto a
   recém-criada e outras `COMPACTION_SUMMARY`) com `compactedAt=NOW()`
4. incrementar `Conversation.compactionCount`
5. registrar `CostEvent` com `meta.source=compaction`

### REQ-5 — Pipeline após compactação
**WHEN** a persistência completa
**THE SYSTEM SHALL** enviar ao OR a lista
`[*system_msgs, summary_msg, *recent_msgs]` em vez do histórico original
e emitir SSE `compaction_done` com `{summary, tokens_before, tokens_after,
limit, cost_usd}`.

### REQ-6 — Falha de compactação
**IF** a chamada ao modelo falha **OR** o resumo retorna vazio **OR** a
persistência falha
**THEN THE SYSTEM SHALL** emitir SSE `compaction_failed` com
`{error, tokens_before, limit}` e continuar enviando o histórico original
ao OR (modo degradado — pode estourar contexto).

### REQ-7 — Carregamento de conversa
**WHEN** o frontend chama `GET /api/chat/conversations/:id`
**THE SYSTEM SHALL** retornar apenas mensagens com `compactedAt IS NULL`
por padrão.
**WHEN** o frontend passa `?includeCompacted=1`
**THE SYSTEM SHALL** retornar todas as mensagens.

### REQ-8 — Envio de mensagem
**WHEN** o frontend chama `POST /api/chat/conversations/:id/send`
**THE SYSTEM SHALL** montar o histórico para o chat service usando apenas
mensagens com `compactedAt IS NULL` (evita loop de re-compactação).

### REQ-9 — UI: barra de contexto
**WHEN** há conversa ativa e dados de `context_usage`
**THE SYSTEM SHALL** mostrar uma barra de progresso no topo do chat com:
- texto: `tokens.toLocaleString() / limit.toLocaleString() · pct%`
- cor: emerald se `pct<60`, amber se `60≤pct<80`, rose se `pct≥80`
- botão "Ver resumo" visível quando `lastCompaction != null`

### REQ-10 — UI: modal de resumo
**WHEN** o user clica em "Ver resumo"
**THE SYSTEM SHALL** abrir um modal fullscreen com backdrop blur, header
mostrando `tokens_before → tokens_after` + `cost_usd`, e markdown
renderizado do resumo.

### REQ-11 — UI: render de COMPACTION_SUMMARY
**WHEN** uma conversa é carregada e contém mensagens
`kind=COMPACTION_SUMMARY`
**THE SYSTEM SHALL** NÃO renderizá-las como bubble do chat e SIM hidratar
`lastCompaction` com o conteúdo da mais recente (pra preservar o botão
"Ver resumo" entre reloads).

### REQ-12 — Isolamento de workspace
**THE SYSTEM SHALL** garantir que `_persist_compaction()` cruze
`userId` ao validar a conversa, mesmo quando o `conversation_id` já tenha
sido validado pelo Node API (defesa em profundidade).

## Critérios de aceite

- [x] `context_usage` SSE emitido antes de cada chamada ao OR
- [x] Trigger em ≥70% com `K_KEEP_RECENT=6`
- [x] Resumo persistido como `SYSTEM`/`COMPACTION_SUMMARY`
- [x] Antigas marcadas com `compactedAt=NOW()`
- [x] `compactionCount` incrementado
- [x] `CostEvent` com `meta.source=compaction`
- [x] `GET /conversations/:id` filtra `compactedAt IS NULL` por padrão
- [x] `POST /conversations/:id/send` filtra `compactedAt IS NULL`
- [x] `_persist_compaction` valida ownership cruzando `userId`
- [x] `compaction_failed` SSE em modo degradado
- [x] UI: barra com tons + modal markdown + filtro de COMPACTION_SUMMARY
- [x] Testes unitários: `test_token_limits.py` + `test_compaction.py`

## Fora de escopo

- Configuração de threshold por user (hard-coded 0.70 por enquanto)
- Modelo dedicado pra compactação (usa o mesmo do chat — mais simples)
- Tokenizer exato por modelo (usa estimativa empírica)
- Recompactação de resumos antigos quando o total ainda ultrapassa o
  limite (acumula `compactionCount` mas não re-resume resumos)
- Botão manual "compactar agora" na UI (auto-only)
