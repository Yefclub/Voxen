# 089 — Fix: crash do chat por `tools` malformado em mensagem HITL_RESPONSE

## Contexto

Incidente em produção (2026-07-13): ao aprovar a criação de uma nota via
confirmação HITL (human-in-the-loop), o chat inteiro passava a quebrar com a
tela de erro do React (`ErrorBoundary`, "Algo deu errado") sempre que a
conversa era carregada/recarregada.

Causa raiz: `approveChatAction` (`apps/web/src/lib/chat/runtime.ts`) grava a
mensagem `SYSTEM`/`HITL_RESPONSE` com um `tools: [{ approvalId, state:
'approved', noteId }]` — um objeto sem `id`/`name` e com `state: 'approved'`,
que não existe no union `ToolState`. Essa forma nunca correspondeu ao tipo
`ToolEvent` esperado pelo resto do pipeline de render.

O frontend (`chat.tsx`) trata TODA mensagem não-`USER` pelo mesmo caminho de
render de segments, incluindo `HITL_RESPONSE` — não há discriminação por
`kind`. `segmentsFromPersistedTools` (`chat-segments.ts`) confiava
cegamente no shape vindo da coluna `tools` (JSONB, sem validação de schema
no Prisma) e repassava direto pro `ThinkingBlock`, que chama
`prettifyToolName(tool.name)`. Com `name` ausente, `name.replaceAll(...)`
lançava `TypeError: Cannot read properties of undefined (reading
'replaceAll')` durante o render — sem try/catch nesse caminho, o erro sobe
até o `ErrorBoundary` mais próximo e derruba a tela inteira do chat pra
aquele usuário.

Fix imediato (fora deste PR, direto no banco): a única mensagem já afetada
em produção teve seu campo `tools` zerado manualmente (o texto humano da
confirmação já está em `content`, então nada foi perdido).

Este PR endereça a causa raiz e adiciona uma blindagem de borda para que um
dado malformado — deste ou de qualquer bug futuro — nunca mais derrube o
chat inteiro.

## Requisitos (EARS)

- **Ubiquitous**: `approveChatAction` NUNCA deve gravar em `ChatMessage.tools`
  um valor que não corresponda ao shape `ToolEvent` (`id`, `name`, `state`
  dentre os valores válidos de `ToolState`).
- **Event**: quando `approveChatAction` cria a mensagem `HITL_RESPONSE` de
  confirmação de nota, o campo `tools` DEVE ficar ausente/`null` — o texto em
  `content` já é a confirmação legível completa, o array de tools é
  redundante para esse `kind` de mensagem.
- **Ubiquitous**: `segmentsFromPersistedTools` (fronteira entre a coluna
  JSONB não tipada e o pipeline de render tipado) SEMPRE deve validar cada
  entrada de `tools` antes de repassá-la adiante — `id`/`name` string
  não-vazia e `state` pertencente a `ToolState`.
- **Unwanted behavior**: se `tools` contiver entradas malformadas (de
  qualquer origem — histórico já gravado ou bug futuro), essas entradas
  DEVEM ser descartadas silenciosamente do array resultante em vez de
  quebrar o render; se sobrar zero entradas válidas, o `tool-group` não deve
  aparecer (mesmo comportamento de "sem tools").

## Critérios de aceite

- [x] `approveChatAction` não grava mais `tools` malformado na mensagem
      `HITL_RESPONSE` (campo omitido, default `null` do Prisma).
- [x] `segmentsFromPersistedTools` filtra entradas inválidas antes de montar
      o `tool-group` segment.
- [x] Teste unitário cobrindo: entradas malformadas descartadas mantendo as
      válidas; array só com entradas malformadas retorna `[]`.
- [x] Teste de integração (`chat-single-session.test.ts`) confirmando que a
      mensagem `HITL_RESPONSE` criada por `approveChatAction` tem
      `tools: null`.
- [x] `make lint` / `make typecheck` / testes TS sem erro.

## Fora de escopo

- Migração retroativa de dados históricos além da mensagem já corrigida
  manualmente em produção (não há evidência de outras linhas malformadas —
  confirmado por query direta).
- Reporte server-side de crashes de `ErrorBoundary` (gap real, mas
  problema separado — hoje só loga no console do navegador).
- Revisão geral do modelo `tools`/`segments` (spec 078/#369) — este PR é um
  fix pontual, não um redesenho.
