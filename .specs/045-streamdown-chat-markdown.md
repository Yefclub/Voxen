# 045 — Streamdown no rendering de markdown do chat

## Contexto

O componente `Markdown` (`apps/web/src/client/components/ui/markdown.tsx`) usa
`react-markdown` + `remark-gfm`. Durante o streaming SSE do agente (chat principal
em `pages/chat.tsx` e chat flutuante da transcrição em `pages/transcricoes-detalhe.tsx`),
o `<Markdown>{msg.content}</Markdown>` recebe o conteúdo crescendo a cada token e
**re-parseia o markdown inteiro a cada token**. Isso causa reflow visível ("piscar")
de tabelas e blocos de código enquanto a resposta chega — uma tabela meio-fechada
ou um fence ``` ainda não terminado fazem o layout pular.

**Streamdown** (https://github.com/vercel/streamdown, Vercel, Apache-2.0, v2.5.0)
é um drop-in para `react-markdown` desenhado para streaming de modelos de IA:

- Quebra o markdown em **blocos** e memoiza cada bloco — só o bloco que mudou
  re-renderiza, eliminando o reflow dos blocos já estáveis.
- `parseIncompleteMarkdown` (default) completa sintaxe parcial (negrito/links/fences
  ainda abertos) para o render parcial ficar estável.
- Hardening de HTML embutido via `rehype-harden` (não usa `rehype-raw`) e
  `defaultUrlTransform` (neutraliza `javascript:`/`data:`) — mesma postura segura do
  renderer atual.
- Inclui `remark-gfm` por padrão (tabelas/strikethrough/autolink).

### Bundle (decisão sobre Mermaid/KaTeX/Shiki)

Inspeção do `dist` instalado: o pacote tem ~104 KB e **não** importa Mermaid, KaTeX
ou Shiki estática nem dinamicamente no chunk principal. Esses são **plugins opt-in**
(`plugins` prop). Como NÃO vamos passar `plugins.mermaid`, `plugins.math` nem
`plugins.code`, nada de Mermaid/KaTeX/Shiki entra no bundle. Decisão: **manter os
três desligados** — o chat do Voxen não precisa de diagramas/fórmulas, e os blocos
de código continuam renderizados pelo nosso `CodeBlock` (Tailwind, sem highlight
pesado), preservando o look atual e o bundle enxuto.

## Requisitos (EARS)

- **R1** — O componente `Markdown` DEVE renderizar via `Streamdown`, mantendo a
  mesma API pública (`children: string`, `className?: string`) para que todos os
  call sites (chat principal, cards de tool, transcrição) sigam funcionando sem
  alteração.
- **R2** — Enquanto o conteúdo estiver em streaming, blocos já completos (parágrafos,
  tabelas, blocos de código fechados) NÃO DEVEM re-renderizar/piscar a cada token
  novo.
- **R3** — Quando um bloco de código ou tabela estiver parcial (fence/linha ainda
  abertos), o sistema DEVE renderizá-lo de forma estável (sem reflow visível),
  via `parseIncompleteMarkdown`.
- **R4** — O resultado visual DEVE ser idêntico ao atual: tema zinc, tipografia
  (títulos `font-display`, listas, blockquote violeta), blocos de código com header
  + botão de copiar, código inline emerald, tabelas com bordas zinc, links violeta.
- **R5** — O sistema NÃO DEVE renderizar HTML embutido não-confiável (sem
  `rehype-raw`) e DEVE neutralizar URLs perigosas (`javascript:`/`data:`).
- **R6** — Links externos DEVEM abrir com `target="_blank"` e
  `rel="noopener noreferrer"`.
- **R7** — O bundle NÃO DEVE incluir Mermaid, KaTeX nem Shiki (plugins opt-in
  mantidos desligados).

## Não-objetivos

- Não adicionar syntax highlighting (Shiki) — fora de escopo; o `CodeBlock` atual
  já atende e mantém o bundle leve.
- Não suportar diagramas Mermaid nem fórmulas KaTeX no chat.
- Não alterar `apps/chat`, `apps/worker` nem rotas de backend.
- Não mudar os call sites — a troca é interna ao componente `Markdown`.

## Critérios de aceite

- `make lint`, `make typecheck`, `make test-ts` verdes; `bun run build` em `apps/web`
  conclui sem erro.
- Streamdown 2.5.0 (Apache-2.0) adicionado em `apps/web/package.json`.
- `markdown.tsx` não usa `dangerouslySetInnerHTML` inseguro nem `rehype-raw`.
- Verificação visual MANUAL (não há Playwright no projeto): conferir no chat
  principal e no chat flutuante que (a) tabelas e blocos de código não piscam
  durante o stream; (b) tema/tipografia inalterados; (c) links externos abrem em
  nova aba com `rel` seguro; (d) botão de copiar do bloco de código funciona.
