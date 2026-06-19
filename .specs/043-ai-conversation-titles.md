# 043 — Títulos de conversa gerados por IA

## Contexto

O título de uma conversa nova era os primeiros 60 caracteres da 1ª mensagem do
usuário (`chat.ts`, send handler) — funcional mas feio. Pedido do owner: gerar o
título por IA a partir da 1ª mensagem.

## Escopo

- Gerar um título curto por IA a partir da 1ª mensagem do usuário, sem atrasar a
  resposta do chat. Aplica-se a conversas gerais (default "Nova conversa"); o chat
  contextual de transcrição mantém "Sobre: <transcrição>".

## Requisitos

### R1 — Geração

- WHEN a 1ª mensagem de uma conversa "Nova conversa" é enviada THEN o sistema SHALL
  gerar um título curto por IA (≤ ~6 palavras) a partir do conteúdo.
- WHEN a geração falha / setup incompleto / sem texto THEN o sistema SHALL manter o
  fallback (primeiros 60 chars) — nunca quebra o envio.

### R2 — Sem latência na resposta

- WHEN a 1ª mensagem é processada THEN a geração do título SHALL ocorrer EM PARALELO
  com a resposta do agente (não atrasa o time-to-first-token). O título da IA SHALL
  ser gravado ao fim do stream (antes de fechar), pra o `refreshConversations` do
  front (pós-stream) já pegar o título novo.

### R3 — Implementação

- O chat service expõe `POST /title` (`{message}` → `{title}`): uma chamada barata,
  sem reasoning (`effort: none`), modelo de chat padrão; custo atribuído ao user
  (CostEvent `source: title`). Best-effort.
- O web (`chat.ts`) chama `/title` em paralelo no 1º envio e grava o título no
  `persistPartial`.

## Fora de escopo

- Re-gerar título em conversas existentes / em cada mensagem.
- Título por IA pro chat contextual de transcrição (mantém "Sobre: ...").
- Edição manual de título (já existe via PATCH).

## Critérios de aceite

- [ ] 1ª mensagem gera título por IA; falha → fallback de 60 chars.
- [ ] Sem latência adicional perceptível na resposta.
- [ ] ruff/mypy/pytest (chat) + typecheck/lint (web) verdes.
