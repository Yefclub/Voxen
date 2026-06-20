# 057 — Navegação mobile sem header (voltar flutuante + destinos no Perfil)

## Contexto

No mobile (< `md` = 768px) o shell ainda renderizava um header no topo (o
`Topbar`, ou na PR #277 um "header mínimo"/`MobileTopBar`). Decisão do owner:
**no mobile NÃO deve existir header nenhum no topo**. A navegação passa a ser
controlada inteiramente por:

1. **Bottom-nav** (`mobile-bottom-nav.tsx`) — abas de topo: Chat, Jobs,
   Transcrições, Grafo + menu do Perfil.
2. **Botão de voltar flutuante por página** — sobrepõe o conteúdo no canto
   superior esquerdo, só em sub-páginas.
3. **Swipe da borda esquerda** — abre o drawer de navegação (bônus, não é o
   caminho principal de acesso).

O `Topbar` desktop continua igual (≥ 768px): header + indicador de contexto do
chat + menu de usuário, ao lado da `Sidebar`.

### Destinos que só existiam na sidebar/drawer

Dashboard, Notas, Automações, Setup e os de admin (Usuários, Custos,
Integrações) não são abas da bottom-nav. Pra não dependerem do gesto de swipe,
eles passam a viver também no **menu do Perfil da bottom-nav** (dropdown que abre
pra cima).

### Pesquisa de padrões

Padrões mobile 2025 para apps sem header:

- **Bottom navigation** como navegação primária (iOS tab bar / Material bottom
  nav) — 3 a 5 destinos; o "a mais" entra num menu "Perfil/Mais". Voxen usa 4
  abas + Perfil.
- **Voltar contextual** flutuante quando não há app bar — alvo de toque ≥ 40px
  (recomendação Apple HIG 44pt / Material 48dp; usamos 40px com folga visual),
  fundo translúcido + blur pra legibilidade sobre qualquer conteúdo, ação
  `history.back()`.
- **Edge swipe** pra gavetas — zona de borda estreita (~24px) e deslocamento
  mínimo (~60px) pra não capturar toques de conteúdo nem scroll.

### Caveat (swipe em PWA no navegador)

A zona de swipe na borda esquerda **colide com o gesto nativo de "voltar"** do
navegador/SO (Chrome/Safari mobile). É confiável apenas em **PWA instalado
(standalone)**, onde o gesto do navegador não intercepta. Por isso o swipe é
**bônus** — todos os destinos têm acesso determinístico via bottom-nav (abas +
menu do Perfil), sem depender do gesto. Documentado em `use-edge-swipe.ts`.

## Requisitos (EARS)

- **R1** — While a viewport está no mobile (< `md`), the shell shall NÃO renderizar
  nenhum header/barra no topo. O `Topbar` é `hidden md:flex`.

- **R2** — While no mobile, the conteúdo principal shall começar do topo
  respeitando `safe-area-inset-top` (sem buraco onde antes ficava o header).

- **R3** — The componente `MobileTopBar` NÃO deve existir no código (era o
  "header mínimo" rejeitado pelo owner); nenhuma referência a ele deve permanecer.

- **R4** — When a rota corrente é uma sub-página no mobile (`showsMobileBack` é
  true) e a rota não tem chrome próprio (`hasOwnMobileChrome` é false), the shell
  shall renderizar um botão de voltar flutuante (`md:hidden`), posicionado no
  canto superior esquerdo (`position: fixed`), respeitando `safe-area-inset-top`,
  com fundo translúcido + blur e alvo de toque ≥ 40px.

- **R5** — When a rota é uma aba de topo da bottom-nav (`isBottomNavTab`), the
  botão de voltar flutuante shall NÃO ser renderizado.

- **R6** — When a rota é `/grafo` (ou sub-rota), que tem chrome próprio de
  navegação (`hasOwnMobileChrome`), the botão de voltar flutuante shall NÃO ser
  renderizado (evita duplicar controles).

- **R7** — When o botão de voltar é acionado, the shell shall navegar para trás
  no histórico (`navigate(-1)`).

- **R8** — The rótulo do botão de voltar shall vir do i18n (`common.back`) nos
  dois locales (pt-BR "Voltar" / en "Back"). Sem string hardcoded.

- **R9** — While no mobile, the menu do Perfil da bottom-nav shall listar, além de
  Perfil e Sair, os destinos únicos que não são abas: Dashboard, Notas,
  Automações, Setup — e, somente para usuários ADMIN, Usuários, Custos e
  Integrações.

- **R10** — The lista de destinos do menu do Perfil shall derivar da fonte
  canônica `NAV` (exportada de `sidebar.tsx`), filtrando os itens que são abas de
  topo (`isBottomNavTab`) e aplicando o gate de admin por `user.role`. Sem
  duplicar a lista de rotas/labels/ícones.

- **R11** — When um item do menu do Perfil é acionado, the dropdown shall navegar
  via `NavLink` e fechar.

- **R12** — While o menu do Perfil tem muitos itens (ex.: admin), the dropdown
  shall rolar (`max-height` + `overflow-y-auto`) e respeitar o
  `safe-area-inset-bottom`.

- **R13** — The drawer de navegação por swipe shall continuar existindo, aberto
  via `useEdgeSwipe` e fechável por overlay, tecla Escape e swipe de volta. O
  acesso aos destinos NÃO deve depender dele.

- **R14** — While a viewport é desktop (≥ `md`), the shell shall permanecer
  inalterado: `Topbar` + `Sidebar` normais; nenhum dos elementos mobile
  (botão de voltar, bottom-nav) deve aparecer.

- **R15** — While no mobile e na rota `/chat`, a ausência de header shall liberar
  altura adicional; o empty state (logo) e o composer devem caber sem scroll
  adicional (o `/chat` é full-bleed e gerencia a própria altura).

## Critérios de aceite

- `isBottomNavTab` / `showsMobileBack` / `hasOwnMobileChrome` cobertos por testes
  unitários puros (`lib/mobile-nav.test.ts`), incluindo a regra de decisão do
  botão de voltar (`showsMobileBack && !hasOwnMobileChrome`).
- `make lint`, `make typecheck`, `make test-ts`, `cd apps/web && bun run build`
  verdes.

## Arquivos

- `apps/web/src/client/lib/mobile-nav.ts` — taxonomia de rotas (novo).
- `apps/web/src/client/lib/mobile-nav.test.ts` — testes (novo).
- `apps/web/src/client/lib/use-edge-swipe.ts` — swipe calibrado + caveat PWA.
- `apps/web/src/client/components/layout/topbar.tsx` — desktop-only (`hidden md:flex`).
- `apps/web/src/client/components/layout/mobile-back-button.tsx` — botão flutuante (novo).
- `apps/web/src/client/components/layout/mobile-bottom-nav.tsx` — destinos no menu do Perfil.
- `apps/web/src/client/components/layout/mobile-nav-drawer.tsx` — drawer full-screen (bônus).
- `apps/web/src/client/components/layout/sidebar.tsx` — exporta `NAV` (fonte canônica).
- `apps/web/src/client/components/layout/app-layout.tsx` — orquestra back flutuante + swipe.

## Fora de escopo

- Mudanças de auth ou rotas.
- Novas dependências.
- Verificação visual automatizada (Voxen não usa Playwright) — listada como
  validação manual no PR.
