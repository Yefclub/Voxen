# 039 — Hierarquia do /chat no mobile

## Contexto

No `/chat` em viewport mobile, o estado vazio (logo + título + descrição + 4 cards
de sugestão) não cabe entre a topbar (64px + safe-area) e a bottom-nav (64px +
safe-area). O EmptyState tinha ~600px de altura (logo 88px, `py-16`, `space-y-8`,
4 cards empilhados em `grid-cols-1`) contra ~590px disponíveis — então logo/info/
botões cortavam e exigiam rolagem.

## Escopo

- Tornar o EmptyState do `/chat` compacto e responsivo no mobile, cabendo sem
  rolagem; manter o visual atual no desktop (`sm+`).

## Requisitos

- WHEN o `/chat` é aberto vazio em viewport mobile THEN logo, título, descrição e
  os cards SHALL caber na área visível sem exigir rolagem do estado vazio.
- WHEN em desktop (`sm+`) THEN o layout do EmptyState SHALL permanecer como antes
  (logo 88px, `py-16`, título `text-2xl`, cards em 2 colunas).
- A caixa de input (PromptBox) SHALL continuar visível e fixa no rodapé.

## Implementação

- Logo `h-16` no mobile → `sm:h-[88px]`; remove o `style` inline que fixava 88px.
- `py-8`/`space-y-6` no mobile → `sm:py-16`/`sm:space-y-8`; título `text-xl` →
  `sm:text-2xl`.
- Cards: `grid-cols-2` (em vez de `grid-cols-1`) no mobile — 2 linhas em vez de 4,
  cortando ~metade da altura.

## Fora de escopo

- Mudar o shell global (`app-layout`) ou a cadeia de altura das outras páginas.
- Redesenhar os cards de sugestão ou o conteúdo do estado vazio.

## Critérios de aceite

- [ ] Em mobile, `document` não exige rolagem pra ver logo/título/cards do vazio.
- [ ] Desktop inalterado. typecheck, lint, prettier e build verdes.
- [ ] Verificação visual no mobile após deploy (Easypanel).
