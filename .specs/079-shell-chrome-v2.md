# Spec 079 — Shell chrome v2 (rail padrão, header flutuante, chat no mobile)

## Status

Aprovado pelo owner (2026-07-12).

## Contexto

O shell (`apps/web/src/client/components/layout/`) tinha três inconsistências
acumuladas de PRs anteriores (spec 073/076):

1. **Sidebar com dois mecanismos de colapso.** Um estado persistido
   (`useSidebarCollapsed`, default `false`) usado nas rotas normais, e um
   forçamento especial só em `/chat`/`/` desktop (`routeWantsCollapse` +
   `chatExpandOverride`, que resetava a cada navegação) que trocava o botão
   flutuante simples pelo `SidebarRail` (ícones + tooltip). Fora do chat,
   colapsar mostrava só um botão solto — sem rail.
2. **Topbar full-width fixo em fluxo, desktop-only.** Barra `h-16` ocupando
   o topo inteiro, com uma área de título à esquerda que nenhuma rota
   preenchia (dead code) e os controles (tema, chat, avatar) à direita.
   Escondida no mobile (`hidden md:flex`) — lá o avatar vivia só na
   bottom-nav.
3. **Mobile `/` renderizava uma Home simplificada** (`pages/home.tsx`)
   diferente do chat que o desktop já usa em `/`.

O owner decidiu consolidar as três em uma linha visual única: a aparência
colapsada (rail) vira o padrão em toda página desktop; o cabeçalho vira um
pill flutuante como a sidebar, só do tamanho dos botões, e passa a existir
também no mobile; e o mobile `/` vira o chat também (paridade com desktop),
escondendo a bottom-nav nessa rota específica (o rodapé é o promptbox).

## Requisitos

### Ubiquitous

- The system shall usar um único mecanismo de colapso de sidebar
  (`useSidebarCollapsed`) — sem forçamento especial por rota. O padrão
  (quando não há preferência salva no `localStorage`) é colapsada (rail).
- The system shall exibir o `SidebarRail` (ícones com tooltip) sempre que a
  sidebar estiver colapsada em qualquer rota desktop, exceto `/grafo` (que
  não monta sidebar — full-bleed).
- The system shall renderizar o `Topbar` como elemento `fixed` (pill,
  `rounded-2xl`, blur, mesma linguagem visual da sidebar) ancorado no canto
  superior direito, dimensionado ao conteúdo (não full-width), em mobile e
  desktop.
- The system shall aplicar um padding-top ao conteúdo (`<main>`) em toda
  rota não full-bleed, suficiente para não ficar coberto pelo `Topbar`
  flutuante — substitui o padding específico que só o botão de voltar mobile
  tinha antes.
- The system shall renderizar a experiência de chat (`ChatPage`) em `/` tanto
  no desktop quanto no mobile — `/` e `/chat` passam a ser equivalentes em
  toda largura de tela.

### Event-driven

- When o usuário expande a sidebar (clique no botão do rail ou no
  `SidebarHeader`), the system shall persistir a preferência (`setCollapsed`)
  — a sidebar permanece expandida entre navegações até o usuário recolher de
  novo (mudança intencional: antes, no chat, expandir resetava a cada troca
  de rota).
- When o usuário está em `/` ou `/chat` no mobile, the system shall ocultar a
  `MobileBottomNav` (o rodapé é o promptbox do chat) e exibir um botão
  flutuante (`MobileMenuButton`, canto superior esquerdo, `md:hidden`) que
  abre o `MobileNavDrawer` já existente.
- When o usuário acessa `/?shared=1`, the system shall continuar
  redirecionando para `/transcricoes` (comportamento preexistente,
  inalterado).

### State-driven

- While a rota é `/grafo` (ou sub-rota), the system shall manter o
  comportamento full-bleed existente: sem sidebar, sem padding-top reservado
  no `<main>`, `Topbar` seguindo visível por cima (como já era).
- While a rota tem botão de voltar mobile (`showsMobileBack &&
  !hasOwnMobileChrome`), the system shall nunca exibir simultaneamente o
  `MobileMenuButton` — são mutuamente exclusivos por construção
  (`showMobileNavButton = isChat && !isDesktop && !showBack`).

### Unwanted behavior

- If não houver preferência de sidebar salva no `localStorage` (chave
  ausente), then the system shall tratar como colapsada (`true`) — só o
  valor `'0'` explícito resulta em expandida; qualquer outro valor (`'1'` ou
  inesperado) resulta em colapsada.
- If `home.tsx` não tiver mais nenhuma referência após `/` passar a
  renderizar `ChatPage` sempre, then the system shall remover o arquivo e as
  strings i18n exclusivas dele (sem código/recursos órfãos).

## Decisões de implementação

**Mecanismo único de colapso.** `routeWantsCollapse`/`chatExpandOverride`/
`showFloatingOpen` foram removidos de `sidebar.tsx`. Como o padrão agora é
colapsado em toda rota, o `SidebarRail` cobre o caso que antes só existia no
chat — o antigo "botão flutuante simples" (fora do chat, colapsada) deixou de
existir enquanto estado possível: colapsada sempre mostra o rail completo.

**`resolveInitialCollapsed` (nova função pura, `sidebar-state.ts`).** Extraída
para ser testável sem DOM: `stored === '0' → false`; qualquer outro valor
(incluindo `null`/ausente) → `true`. Usada para inicializar o store singleton.

**`isChatRoute`/`hidesBottomNav` (novas funções puras, `mobile-nav.ts`).**
`isChatRoute(pathname)` é `pathname === '/chat' || pathname === '/'` (match
exato, mesmo padrão das demais funções do módulo). `hidesBottomNav(pathname,
isDesktop)` combina `hasOwnMobileChrome` (grafo) com `isChatRoute && !isDesktop`.
Reaproveitada em `app-layout.tsx` (visibilidade da bottom-nav) e implicitamente
alinhada com o `inChat` do `Topbar` (mesma função `isChatRoute`, eliminando a
duplicação que existia antes entre `topbar.tsx` e `app-layout.tsx`).

**Botão de menu mobile nunca colide com o botão de voltar.** A leitura
inicial assumia que `showBack` nunca seria `true` na rota de chat (`/chat`
não está em `BOTTOM_NAV_TABS`, então `showsMobileBack('/chat')` já era
`true` antes desta spec). Sem tratamento, `/chat` visitada diretamente no
mobile mostraria **os dois** botões flutuantes ao mesmo tempo (voltar E
abrir menu). A implementação resolve isso dando precedência ao botão de
voltar: `showMobileNavButton = isChat && !isDesktop && !showBack` — quando
`showBack` é `true`, o menu não aparece. Efeito colateral aceito: `/chat`
visitada diretamente (como sub-página) no mobile mostra "voltar" em vez de
"abrir menu" (mesma UX de qualquer outra sub-página); só a aba raiz `/`
(onde `showBack` é sempre `false`) mostra o botão de abrir menu.

**Remoção de `home.tsx`.** Confirmado via grep que `root-entry.tsx` era a
única referência. Removido o arquivo e as chaves i18n exclusivas dele
(`home.eyebrow`, `home.description`, `home.statReady`, `dashboard.processing`,
`dashboard.failed`) em pt-BR e en. Chaves compartilhadas com `chat.tsx`
(`home.greeting`, `dashboard.fallbackName`) e com outros componentes
(`jobs.queueTitle`, `home.urlPlaceholder`, `home.dropTitle`, `home.dropHint`)
foram mantidas.

**Padding-top do conteúdo (`headerPad`).** `pt-[calc(env(safe-area-inset-top)+5rem)]`
em toda rota não full-bleed. Cálculo: o pill do `Topbar` fica em
`top: calc(safe-area + 1rem)` com altura aproximada de 3.375rem (botões `h-9`
+ `py-2` + borda), terminando em ~4.375rem — `5rem` dá uma folga proposital
de ~0.6rem já que a verificação visual (Playwright) está desligada nesta
entrega. **Ressalva:** este valor pode precisar de ajuste fino no deploy.

**`/grafo` sem padding-top (mantido full-bleed) — colisão visual com o
`Topbar` CONFIRMADA e CORRIGIDA nesta PR.** A barra flutuante própria do
grafo (`grafo.tsx`, `absolute inset-x-0 top-0 z-20`, centralizada até
`max-w-5xl`) ocupava a faixa de altura 0–~76px do topo com segurança porque
o Topbar **antigo** era `hidden` no mobile e reservava 64px de fluxo no
desktop (empurrando o canvas do grafo, e portanto sua barra, para `y=64`).
Nenhuma das duas condições vale mais: o `Topbar` novo é `fixed`/`z-30`,
aparece em mobile e desktop, e `/grafo` (via `isFullBleed`) não ganha nenhum
padding-top compensatório — então as duas barras passam a ocupar a MESMA
faixa de altura. Confirmado por investigação dedicada (dupla checagem,
incluindo leitura direta de `grafo.tsx`):

- **Mobile**: colisão praticamente garantida — a barra do grafo sempre ocupa
  a largura cheia da viewport (o `max-w-5xl` nunca chega a limitar em tela
  pequena), e o `Topbar` aparece no mobile pela primeira vez, no mesmo canto.
- **Desktop**: muito provável em larguras comuns de laptop (~1024–1350px de
  viewport lógica) — nessas larguras a pill centralizada do grafo (que cresce
  até 1024px) termina a poucos pixels (ou sobrepondo) o canto onde o `Topbar`
  fica. Sem o fix, sem colisão só a partir de ~1268px de largura de viewport.
- Como `Topbar` tem `z-30` > `z-20` da barra do grafo, ele renderizaria **por
  cima**, cobrindo os badges de `GraphStats` ou os botões de 2D/3D e refresh.

**Fix aplicado** (container externo da barra, `grafo.tsx` linha ~304): troca
de `p-3 sm:p-4` (padding uniforme) por padding decomposto por lado, com dois
comportamentos diferentes por breakpoint — mobile empilha verticalmente
(empurra a barra pra baixo do `Topbar`), desktop reserva espaço lateral
(convive na mesma linha, com margem):

```
px-3 pb-3 pt-[calc(env(safe-area-inset-top)+5rem)]
sm:px-4 sm:pb-4
md:pt-4 md:pr-[9rem]
```

- **Mobile (< md, 768px)**: `pt-[calc(env(safe-area-inset-top)+5rem)]` —
  mesmo valor usado no padding-top geral do `<main>` (ver acima), empurra a
  barra do grafo pra baixo da faixa ocupada pelo `Topbar` em vez de competir
  horizontalmente por espaço (que já é escasso no mobile).
- **Desktop (≥ md)**: `md:pt-4` volta o padding-top ao valor original (a
  barra continua na mesma linha horizontal, há espaço lateral suficiente);
  `md:pr-[9rem]` (144px) reserva espaço à direita para a pill (`mx-auto
  max-w-5xl`) nunca se estender até onde o `Topbar` está.

**Critério de não-colisão (verificação geométrica, documentada por não ser
automatizável sem Playwright/regressão visual — fora do escopo desta
entrega):** o padding-right reservado deve ser maior ou igual à largura real
ocupada pelo `Topbar` a partir da borda direita da viewport, em qualquer
largura de tela.

- Largura do `Topbar` em `/grafo` (sem `ChatShellControls`, que só aparece em
  `isChatRoute`): toggle de tema (`h-9 w-9`=36px) + avatar (`h-9 w-9`=36px) +
  `gap-3` (12px, breakpoint `sm+`, que cobre todo desktop) + `px-2.5` (20px)
  + borda (2px) = **106px**.
  - `right-4` do `Topbar` = 16px.
  - Total ocupado a partir da borda direita = 106 + 16 = **122px**.
- Padding-right reservado na barra do grafo = `9rem` = **144px**.
- Margem de segurança = 144 − 122 = **22px** (~1.375rem) — folga proposital,
  já que não há verificação visual nesta entrega.
- **144px ≥ 122px ⇒ critério satisfeito em qualquer largura ≥ 768px** (o
  padding-right é uma constante, não depende da largura da viewport — ao
  contrário do problema original, que só colidia em faixas específicas
  porque a pill crescia com a viewport disponível).
- No mobile (< 768px), o critério muda de "não sobrepor horizontalmente"
  para "não sobrepor verticalmente": a barra do grafo precisa começar depois
  do fim do `Topbar` (`top: calc(safe-area + 1rem)` + altura ~3.375rem ⇒
  termina em ~4.375rem). `pt-[calc(safe-area+5rem)]` ≥ isso, com a mesma
  folga de ~0.6rem usada no padding-top geral do app.

Se no futuro a largura do `Topbar` em `/grafo` mudar (ex.: adicionar um botão
novo), este cálculo precisa ser refeito e o `md:pr-[9rem]` ajustado — não há
teste automatizado que capture essa relação (limitação de Tailwind com
valores arbitrários: não há uma forma direta de compartilhar uma constante
JS testável com uma `className` estática sem introduzir CSS custom
properties, o que ficou fora do escopo deste fix pontual).

## Critérios de Aceite

- [ ] `resolveInitialCollapsed(null)` e `resolveInitialCollapsed('1')` → `true`;
      `resolveInitialCollapsed('0')` → `false`. Testado em `sidebar-state.test.ts`.
- [ ] `SidebarRail` aparece colapsada em qualquer rota desktop (exceto
      `/grafo`); expandir persiste entre navegações.
- [ ] `SidebarSpacer` reserva rail/sidebar cheia/zero corretamente
      (`RAIL_WIDTH+16` / `SIDEBAR_WIDTH+32` / `0` em `/grafo`).
- [ ] `Topbar` é `fixed`, ancorado à direita, sem `title` prop (dead code
      removido), visível em mobile e desktop, com todo o conteúdo (tema,
      controles de chat, avatar) igual nas duas larguras.
- [ ] `isChatRoute`/`hidesBottomNav` testados em `mobile-nav.test.ts`
      (chat routes, grafo, desktop vs. mobile).
- [ ] `/` no mobile renderiza `ChatPage`; `?shared=1` continua redirecionando.
- [ ] `home.tsx` removido (confirmado órfão); i18n sem chaves órfãs
      exclusivas dele.
- [ ] Bottom-nav oculta em `/` e `/chat` no mobile; visível nas demais rotas
      mobile e sempre oculta em `/grafo`.
- [ ] `MobileMenuButton` novo, mobile-only, nunca renderiza junto com
      `MobileBackButton`.
- [ ] Barra de controles do `/grafo` não colide mais com o `Topbar`: padding
      decomposto por breakpoint (`px-3 pb-3 pt-[calc(safe-area+5rem)]
      sm:px-4 sm:pb-4 md:pt-4 md:pr-[9rem]`) satisfaz o critério geométrico
      documentado acima (144px reservados ≥ 122px ocupados pelo `Topbar` em
      `/grafo`, com folga de 22px).
- [ ] `make lint`, `make typecheck`, `bun test` (apps/web) verdes.

## Fora de Escopo

- Verificação visual via Playwright (desligada nesta entrega por decisão do
  owner — conferência acontece no deploy). O fix da colisão `/grafo` ×
  `Topbar` foi aplicado com base em cálculo geométrico (ver seção de
  decisões), não em verificação visual real — vale conferir no deploy.
- Alterações em `BOTTOM_NAV_TABS`/itens da bottom-nav em si (fora da
  visibilidade da barra inteira na rota de chat).
