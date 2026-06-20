# 023 — App shell: cabeçalho fixo, transição de página, limpar atividades e grafo em tela cheia

## Contexto

Quatro melhorias de UI/UX no shell autenticado e na página `/grafo`, agrupadas
porque compartilham o mesmo layout (`app-layout`, `sidebar`, `topbar`) e a mesma
biblioteca de animação (`motion`). Entregues em 4 PRs independentes; esta spec é
o contrato comum.

Problemas observados hoje:

- **Cabeçalho rola junto com a página.** O `Topbar` usa `position: sticky`, mas
  o scroll acontece no nível da window e o `html/body` tem `overflow-x: hidden`,
  o que torna o sticky frágil. O cabeçalho deveria ficar travado no topo em
  qualquer página (exceto `/chat`, que já gerencia a própria altura).
- **Transição de página sem vida.** `AnimatedPage` define `exit`, mas o `App`
  não envolve as rotas em `AnimatePresence`, então a saída nunca dispara — a
  troca de página é um corte seco.
- **Atividade recente sem controle.** O dashboard lista os últimos jobs sem um
  jeito de limpar o painel visualmente.
- **`/grafo` espremido.** O grafo divide espaço com a sidebar e com um inspetor
  fixo de 340px, cortando o canvas. A experiência pede tela cheia.

## Decisões

- **App shell com header travado (PR1).** O container de conteúdo passa a ter
  altura de viewport (`h-dvh`, `overflow-hidden`); o `Topbar` vira flex item
  `shrink-0` e o `<main>` rola internamente (`overflow-y-auto`). O cabeçalho
  deixa de depender de `sticky`. Como o scroll migra da window para o `<main>`,
  um `ScrollToTop` reseta `scrollTop` a cada troca de rota.
- **Transição de página (PR2).** Envolver o `Outlet` autenticado em
  `AnimatePresence mode="wait"`, com `key` na `location.pathname`. Respeitar
  `prefers-reduced-motion`. Não animar `/chat` (layout de altura fixa) nem as
  telas de auth.
- **Limpar atividades (PR3).** Botão "Limpar" no painel de atividade recente do
  dashboard. Ação **não-destrutiva**: persiste um marcador `clearedAt` por
  usuário em `localStorage` e filtra os jobs anteriores a ele. Não chama API,
  não deleta jobs nem transcrições. Novos jobs reaparecem. Toast com "Desfazer".
- **Grafo em tela cheia (PR4).** Em `/grafo`, a sidebar de navegação some e o
  canvas ocupa toda a largura/altura disponível; o `Topbar` permanece. O
  inspetor lateral fixo é removido — detalhes do nó passam a aparecer em tooltip
  no hover, e o duplo-clique abre a fonte. Controles de busca/refresh/stats
  viram uma barra flutuante sobre o canvas. Pan adicional: `espaço + arrastar`
  (botão esquerdo) e `arrastar com botão do meio`, além dos gestos atuais.

## Critérios de aceite

### PR1 — Cabeçalho fixo

- [ ] O `Topbar` permanece visível no topo ao rolar qualquer página autenticada
  (dashboard, jobs, transcrições, notas, automações, admin, conta).
- [ ] O conteúdo rola dentro do `<main>`, não na window.
- [ ] Ao trocar de rota, o `<main>` volta ao topo.
- [ ] `/chat` mantém o comportamento atual (input fixo no fundo, sem regressão).
- [ ] Sidebar `fixed`, `SidebarSpacer` e `VersionFooter` continuam corretos.

### PR2 — Transição de página

- [ ] Trocar de rota autenticada anima saída + entrada (fade/slide curto).
- [ ] Sem flicker, sem scroll preso, sem duplo-render do conteúdo.
- [ ] `prefers-reduced-motion: reduce` desativa a animação.
- [ ] `/chat` e telas de auth não regridem.

### PR3 — Limpar atividades

- [ ] Botão "Limpar" aparece no painel de atividade recente quando há itens.
- [ ] Clicar oculta a lista atual sem chamadas de rede e sem apagar jobs.
- [ ] O estado persiste a reload (por usuário) e novos jobs voltam a aparecer.
- [ ] Toast confirma com opção "Desfazer".

### PR4 — Grafo em tela cheia

- [ ] Em `/grafo` a sidebar de navegação não é renderizada; o `Topbar` fica.
- [ ] O canvas ocupa toda a área disponível, sem corte de visuais.
- [ ] Hover mostra tooltip com label/tipo; duplo-clique abre a fonte (quando há).
- [ ] Pan com `espaço + arrastar` e com `arrastar de botão do meio` funciona,
  além de girar/zoom atuais; fallback 2D (Sigma/SVG) não regride.
- [ ] i18n PT/EN para qualquer string nova.
