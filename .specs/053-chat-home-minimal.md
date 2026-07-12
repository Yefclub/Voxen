# 053 — Home de conversas minimalista (logo + composer)

## Contexto

A página inicial de conversas (`apps/web/src/client/pages/chat.tsx`), no estado vazio
(sem conversa ativa, nenhuma mensagem), exibia: logo Voxen, saudação ("Oi, sou a Vox"),
subtítulo descritivo e um grid de 4 cards de sugestão clicáveis. Esse hero polui a
primeira impressão e compete com o composer.

Decisão do owner: home minimalista — apenas a logo Voxen centralizada acima da barra
de digitar. Sem saudação, subtítulo ou sugestões.

## Escopo

- SÓ o estado vazio (`empty = messages.length === 0 && !active`).
- O fluxo de conversa ativa (com mensagens) NÃO muda.
- O composer (`PromptBox`) e o hint abaixo dele permanecem intactos.

## Requisitos (EARS)

- **R1** — Quando a página `/chat` está no estado vazio, o sistema DEVE exibir somente
  a logo Voxen centralizada acima do composer, sem saudação, subtítulo ou cards de
  sugestão.
- **R2** — Quando há conversa ativa (mensagens carregadas), o sistema DEVE renderizar a
  conversa normalmente, sem alteração de comportamento.
- **R3** — No estado vazio, a logo DEVE ficar verticalmente equilibrada (centralizada no
  espaço acima do composer) e o layout DEVE caber em viewport mobile sem scroll.
- **R4** — O sistema NÃO DEVE deixar código morto: handlers de sugestão (`onPick`),
  imports e chaves i18n exclusivas do hero removido (`chat.emptyTitle`,
  `chat.emptyDescription`, `chat.card.*`) DEVEM ser removidos.

## Critérios de aceite

1. No estado vazio, nenhum texto de saudação/subtítulo e nenhum card aparece — só a logo.
2. O componente `EmptyState` não recebe mais `onPick`/`t` e não referencia chaves i18n.
3. As chaves i18n `chat.emptyTitle`, `chat.emptyDescription` e `chat.card.*` são
   removidas de ambos os locales (pt-BR e en).
4. `make lint`, `make typecheck`, `make test-ts` e `bun run build` passam.

## Validação visual

Não há Playwright no projeto. Requer conferência manual do owner: logo centralizada,
espaçamento agradável até o composer, sem scroll no mobile, conversa ativa intacta.
