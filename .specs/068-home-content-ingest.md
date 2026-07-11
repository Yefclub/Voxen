# 068 — Home com box Conteúdo (URL + upload + drag/drop)

## Contexto

A captura de conteúdo vivia em `/jobs` e o painel de boas-vindas em `/dashboard`.
A home real (`/`) só redirecionava para o dashboard. O fluxo natural do produto é
**abrir o app e colar um link ou soltar um arquivo** — não navegar até "Capturar".

Decisão do owner: a home autenticada (`/`) vira a superfície principal de ingestão
(box **Conteúdo** + fila de jobs). `/dashboard` e `/jobs` deixam de ser páginas
reais e redirecionam para `/`. Detalhe do job (`/jobs/:id`) permanece.

## Escopo

- Página home em `/` com hero + card de ingestão + fila (promovida de `jobs.tsx`).
- Drag-and-drop em página inteira (overlay) e paste de arquivo no input Conteúdo.
- Redirects `/dashboard` → `/` e `/jobs` → `/` (preservando query string).
- Nav: um item home em `/` no lugar de dashboard + jobs separados.
- i18n pt-BR + en; atalho PWA "Capturar" aponta para `/`.
- **Fora de escopo**: remoção do chat, títulos por IA, auto-folders.

## Requisitos (EARS)

- **R1** — Quando o usuário autenticado acessa `/`, o sistema DEVE renderizar a
  home de conteúdo (não redirecionar para `/dashboard`).
- **R2** — A home DEVE exibir um card primário com label **Conteúdo** (não "Link"),
  input grande para URL, badge de detecção de fonte enquanto digita, e botão de
  envio — reutilizando o pipeline `/api/jobs/auto`.
- **R3** — A home DEVE permitir upload de arquivo (controle secundário / modo
  arquivo e file picker), reutilizando `uploadMedia`.
- **R4** — Quando o usuário arrasta arquivo(s) sobre a página, o sistema DEVE
  escurecer a viewport com overlay centrado (mensagem no estilo "Solte o arquivo
  para indexar"). O overlay SÓ ativa se `dataTransfer.types` contiver Files.
- **R5** — Quando o usuário solta um arquivo no overlay, o sistema DEVE enfileirar
  o upload (mesmo fluxo de upload manual).
- **R6** — No input Conteúdo, se o paste trouxer arquivo em `clipboardData.files`,
  o sistema DEVE interceptar o paste e tratar como upload. Caso contrário, o paste
  de texto/URL segue o comportamento normal do campo.
- **R7** — A home DEVE listar a fila de jobs do usuário com progresso SSE (paridade
  com a antiga página `/jobs`).
- **R8** — Quando o usuário acessa `/dashboard`, o sistema DEVE redirecionar para
  `/` com `replace`.
- **R9** — Quando o usuário acessa `/jobs` (lista), o sistema DEVE redirecionar
  para `/` com `replace`, **preservando a query string** (PWA share target:
  `?shared=1`, `url`, `jobId`, erros etc.).
- **R10** — `/jobs/:id` DEVE continuar exibindo o detalhe do job.
- **R11** — A navegação (sidebar desktop, bottom-nav mobile, drawer) DEVE ter um
  único item de home em `/` no lugar de entradas separadas de dashboard e jobs.
- **R12** — Fluxos de auth/onboarding/setup que redirecionavam para `/dashboard`
  DEVEM passar a redirecionar para `/`.
- **R13** — O share target e atalhos PWA que apontavam para `/jobs` DEVEM apontar
  para `/` (ou redirecionar preservando params).
- **R14** — O sistema NÃO DEVE deixar código morto de páginas dashboard/jobs se
  não forem mais usadas como rotas.

## Critérios de aceite

1. `/` mostra hero + box Conteúdo + fila; submit de URL e upload funcionam.
2. Drag de arquivo escurece a página; drop inicia upload.
3. Ctrl+V de arquivo no input Conteúdo inicia fluxo de upload.
4. `/dashboard` e `/jobs` redirecionam para `/`; `/jobs?shared=1&url=...` preserva query.
5. `/jobs/:id` continua acessível.
6. Nav sem "Painel" e "Capturar" separados — um item home.
7. Spec 068 no mesmo PR da implementação.
8. Testes unitários de `mobile-nav` alinhados às novas abas (`/` no lugar de `/jobs`).

## Validação

- Unit: `bun test` em `apps/web` (mobile-nav e demais).
- Manual (owner): beauty da home, paste, drag overlay, share target, mobile bottom nav.
- Sem Playwright/docker neste ciclo (decisão de execução do worktree).
