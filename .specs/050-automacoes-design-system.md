# 050 — Página de Automações no Design System (tema zinc)

## Contexto

A página `apps/web/src/client/pages/automacoes.tsx` (e seus modais) foi escrita com
cores hardcoded (`bg-white dark:bg-zinc-950`, `text-zinc-900 dark:text-zinc-100`,
bordas `border-zinc-200 dark:border-zinc-800`, overlays `bg-zinc-900/60`) em vez das
CSS vars (`--color-app-bg`, `--color-app-surface`, `--color-app-border`,
`--color-app-muted`, etc.) e dos componentes shadcn (`Card`, `Dialog`,
`ConfirmDialog`) usados no resto do app. Resultado: a tela destoa do tema.

Esta é uma mudança **conservadora**: mapeamento mecânico de tokens + troca do
`confirm()` nativo por `ConfirmDialog`. NÃO é redesign. Estrutura, layout e
comportamento permanecem iguais. A lógica das automações (fetch/estado/regras)
NÃO é tocada.

## Requisitos (EARS)

- **R1** — Onde a página usa fundos hardcoded (`bg-white dark:bg-zinc-950`), o
  sistema DEVE usar as superfícies do tema (`var(--color-app-surface)` /
  `var(--color-app-bg-elevated)`) consistentes com as demais telas.
- **R2** — Onde a página usa texto hardcoded (`text-zinc-900 dark:text-zinc-100`),
  o sistema DEVE usar a cor de texto padrão do tema (`text-zinc-100`); texto
  secundário DEVE usar `var(--color-app-muted)`.
- **R3** — Onde a página usa bordas hardcoded (`border-zinc-200 dark:border-zinc-800`),
  o sistema DEVE usar `var(--color-app-border)`.
- **R4** — Quando o usuário aciona a remoção de uma automação, o sistema DEVE
  abrir um `ConfirmDialog` (variant destructive) em vez do `window.confirm()`
  nativo, mantendo o comportamento de confirmar antes da ação destrutiva.
- **R5** — Enquanto um modal próprio da página estiver aberto, o sistema DEVE
  travar o scroll do body para o fundo não rolar atrás (paridade com o
  comportamento do `Dialog` do shadcn / `mobile-nav-drawer`).
- **R6** — Quando `costUsd` de uma execução não for um número válido, o sistema
  DEVE exibir `$0.00` em vez de `$NaN`.
- **R7** — O sistema NÃO DEVE alterar a estrutura, o layout, a UX ou a lógica
  das automações (fetch, estado, validação, regras de frequência/entrega).

## Fora de escopo

- Redesenho da página ou dos cards.
- Migração dos modais próprios (`AutomationForm`, `RunsModal`) para o `Dialog`
  do shadcn — avaliado como arriscado (formulário grande, scroll interno,
  sticky header/footer). Mantidos como modais próprios com trava de scroll (R5).
- Qualquer mudança em endpoints/backend.

## Critérios de aceite

1. Nenhuma classe `bg-white`, `dark:bg-zinc-950`, `text-zinc-900`,
   `dark:text-zinc-100` ou `border-zinc-200 dark:border-zinc-800` remanescente
   na página (substituídas pelas vars do tema).
2. Remover automação abre `ConfirmDialog`, não `window.confirm()`.
3. Abrir qualquer modal trava o scroll do body; fechar restaura.
4. Execução com `costUsd` inválido mostra `$0.00`.
5. `make lint`, `make typecheck`, `make test-ts` e `bun run build` verdes.

> Validação visual via Playwright indisponível no ambiente (sem Playwright neste
> projeto). Mudança é mapeamento de tokens 1:1 — requer conferência visual manual
> do owner após o deploy.
