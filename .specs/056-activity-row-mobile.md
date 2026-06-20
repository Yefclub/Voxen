# 056 — ActivityRow responsivo no mobile

## Contexto

O `ActivityRow` no dashboard (`apps/web/src/client/pages/dashboard.tsx`) usa um
layout de colunas lado-a-lado: miniatura (`SourcePreview`, `h-14 w-24` = 96px) +
`Badge` (`min-w-28` = 112px) + coluna `flex-1` (url + data relativa) + `ArrowRight`.

Em telas estreitas (~360px), depois da miniatura e do badge sobra pouquíssimo
espaço horizontal pra coluna de texto. A data relativa ("há cerca de 20 horas")
quebra **palavra por palavra** em várias linhas e a url some. Visualmente ruim.

A `JobRow` em `jobs.tsx` já é responsiva (empilha com `flex-col sm:flex-row` e o
badge ocupa a própria linha) e não tem miniatura competindo por espaço — está OK,
fora de escopo.

## Requisitos (EARS)

- **R1** — When a tela está no breakpoint mobile (default, < `sm`), the
  `ActivityRow` shall empilhar o conteúdo de texto: miniatura à esquerda e, ao
  lado, uma coluna `flex-1` com a url truncada em cima e, embaixo, uma linha
  contendo o `Badge` (largura automática) seguido da data relativa.

- **R2** — While no breakpoint mobile, the `Badge` shall ter largura automática
  (sem `min-w-28`) e `shrink-0`, ocupando só o necessário pro texto do status.

- **R3** — While no breakpoint mobile, the data relativa shall ser renderizada
  com `whitespace-nowrap` e `truncate`, de modo que **nunca** quebre palavra por
  palavra; quando não couber, trunca com reticências.

- **R4** — While no breakpoint mobile, the url shall ser truncada com reticências
  (`truncate`) numa única linha.

- **R5** — While no breakpoint mobile, the `ArrowRight` shall ficar oculto
  (`hidden sm:block`) para priorizar o espaço de texto.

- **R6** — When a tela está em `sm` ou maior, the `ActivityRow` shall manter
  exatamente o layout atual: miniatura | badge `min-w-28` | coluna `flex-1`
  (url em cima, data embaixo) | `ArrowRight`. Os ajustes mobile são aplicados via
  default e revertidos por prefixos `sm:`.

- **R7** — A miniatura shall poder ser ligeiramente menor no mobile
  (`h-12 w-16`) e voltar a `sm:h-14 sm:w-24` no desktop, pra dar mais respiro ao
  texto.

## Critérios de aceite

1. Em ~360px: data relativa aparece inteira (ou truncada com `…`) numa única
   linha, sem quebra palavra-por-palavra.
2. Em ~360px: url visível e truncada com `…`, badge compacto.
3. Em `sm`+: layout idêntico ao anterior (3 colunas + seta).
4. `make lint`, `make typecheck`, `make test-ts` e `bun run build` verdes.

## Fora de escopo

- `JobRow` (jobs.tsx) — já responsiva.
- Qualquer mudança de dados, API ou i18n.
