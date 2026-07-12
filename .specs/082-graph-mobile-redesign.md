# Spec 082 — Redesenho do Grafo (/grafo) para mobile

## Status

Aprovado pelo owner (2026-07-12).

## Contexto

O owner relatou "/grafo horrível no mobile, por vários motivos" e pediu uma
recriação da experiência mobile (não uma lista fixa de fixes — liberdade de
redesenho, desde que os motivos concretos abaixo sejam endereçados). Leitura
completa de `apps/web/src/client/pages/grafo.tsx` (~1116 linhas) identificou
cinco problemas concretos, todos escopo desta spec:

1. **Barra de controles sobrecarregada.** Um único `flex flex-wrap` continha
   voltar, título (já `hidden sm:flex`, correto), busca (`flex-1
   min-w-[150px]`), toggle 2D/3D, atualizar, **e** `GraphStats` — que por sua
   vez é outro `flex flex-wrap` com 4 itens (transcrições/notas/pastas/
   conceitos) + contagem de conexões. No mobile isso quebra em múltiplas
   linhas dentro de uma barra já estreita (empilhada abaixo do Topbar
   flutuante desde a spec 079).
2. **`GraphStats` sempre visível, sem gate mobile.** Diferente do título
   (`hidden sm:flex`), os stats renderizavam incondicionalmente, lotando a
   barra em qualquer largura de tela.
3. **Câmera 3D com arrastar-pra-girar como padrão.** `is3d` iniciava sempre
   `true` (`cameraMode={is3d ? 'rotate' : 'pan'}`, `draggable`) — rotação
   orbital via drag é um gesto ruim em touchscreen (fácil de disparar sem
   querer, difícil de controlar com precisão) comparado a mouse.
4. **Fallback SVG com viewBox fixo em paisagem.** `GRAPH_VIEWBOX =
   {width:1000, height:620}` (~1.6:1) com `preserveAspectRatio="xMidYMid
   meet"` — em tela retrato (a maioria dos celulares), a escala fica presa
   pela largura, deixando faixas vazias grandes em cima/embaixo e o grafo
   pequeno/apertado no meio.
5. **Alvos de toque pequenos nos nós do grafo.** Raio clampado em 13-32
   (espaço SVG/layout) — em pixels de tela real, especialmente combinado com
   o problema 4 (viewBox subutilizado), o alvo de toque renderizado ficava
   bem abaixo do recomendado (~44px) pras plataformas touch.

A colisão da barra de controles com o `Topbar` flutuante (spec 079,
`pt-[calc(safe-area+5rem)]` no mobile) já estava corrigida e não é reaberta
aqui.

## Requisitos

### Ubiquitous

- The system shall exibir busca, alternância 2D/3D e atualizar como ações
  sempre visíveis na barra de controles do grafo, em qualquer largura de
  tela.
- The system shall preservar os três caminhos de renderização existentes
  (canvas 3D/2D via Reagraph/WebGL, canvas 2D via Sigma/WebGL, fallback SVG
  puro sem WebGL) — nenhuma mudança desta spec remove ou substitui um dos
  três.
- The system shall manter o toggle manual de 2D/3D disponível e funcional em
  qualquer largura de tela, independente do valor inicial de `is3d`.

### Event-driven

- When a página do grafo monta em uma viewport abaixo do breakpoint `md`
  (< 768px) ou sem indicação de ser desktop, the system shall inicializar a
  câmera do grafo em modo 2D (`is3d = false`).
- When a página do grafo monta em uma viewport `md` ou maior, the system
  shall inicializar a câmera do grafo em modo 3D (`is3d = true`), mantendo o
  comportamento prévio no desktop.
- When o usuário aciona o botão de informação (mobile), the system shall
  abrir/fechar um painel dedicado com as estatísticas do grafo
  (transcrições, notas, pastas, conceitos, conexões), sem afetar a fileira
  primária de controles.
- When o container do fallback SVG (sem WebGL) é medido ou redimensionado,
  the system shall recalcular o `viewBox` renderizado a partir da proporção
  real do container.

### State-driven

- While a viewport é menor que o breakpoint `md` (mobile), the system shall
  ocultar as estatísticas completas (`GraphStats`) da fileira primária de
  controles e exibi-las somente sob demanda (painel dedicado, mobile-only).
- While a viewport é `md` ou maior (desktop/tablet largo), the system shall
  exibir as estatísticas completas inline na fileira primária de controles,
  como antes desta spec.
- While o dispositivo de apontamento primário é coarse (touch), the system
  shall aplicar um raio mínimo maior aos nós do grafo (layout compartilhado
  pelos caminhos Sigma e SVG) do que em dispositivos de apontamento fine
  (mouse/trackpad).
- While o fallback SVG está ativo, the system shall dimensionar o `viewBox`
  preservando a densidade visual de nós do padrão (mesma área), ajustando
  apenas a proporção largura/altura à proporção real do container, dentro de
  limites que evitam layouts patologicamente esticados.

### Unwanted behavior

- If o container do fallback SVG ainda não foi medido (ex.: primeiro
  frame), then the system shall usar o `viewBox` padrão em paisagem
  (1000x620) até a primeira medição chegar.
- If a proporção real do container do fallback SVG estiver fora dos limites
  seguros (`MIN_VIEWBOX_ASPECT_RATIO`–`MAX_VIEWBOX_ASPECT_RATIO`), then the
  system shall clampar aos limites em vez de produzir um layout
  patologicamente fino/esticado.
- If o usuário redimensionar a janela após o carregamento inicial (ex.:
  desktop cruzando o breakpoint `md`, ou rotação de tablet), then the system
  shall preservar a escolha atual de `is3d` (manual ou padrão inicial) sem
  forçar reset — a detecção de viewport só decide o valor inicial, não um
  estado sincronizado continuamente.

## Decisões de implementação

**`resolveDefaultIs3d(isDesktop): boolean`** (nova função pura,
`grafo.tsx`). Trivial (`return isDesktop`), mas extraída como função nomeada
e testável — usada como inicializador preguiçoso do `useState` (`useState(()
=> resolveDefaultIs3d(isDesktop))`), rodando uma única vez no mount.
`isDesktop` vem de `useIsDesktop()` (`use-media-query.ts`, breakpoint `md` =
768px, já existente e usado pelo shell). Como é um inicializador de estado
(não um `useEffect` reagindo a mudanças), redimensionar a janela depois do
mount não força `is3d` a mudar — só a escolha inicial é afetada, conforme
pedido ("só o default muda").

**`useIsCoarsePointer()`** (novo hook, `use-media-query.ts`, espelha
`useIsDesktop()`). Media query `(pointer: coarse)` — identifica entrada
primária touch, ortogonal a largura de viewport (notebook touchscreen é
largo mas coarse; janela desktop estreita é fine/mouse). Usado só pra decidir
o raio mínimo de nós (problema 5), não pra decisões de layout.

**`resolveNodeRadiusBounds(coarsePointer): {min, max}`** (nova função pura).
`min` sobe de 13 (`DEFAULT_MIN_NODE_RADIUS`) para 17 (`TOUCH_MIN_NODE_RADIUS`,
~30%) quando `coarsePointer`; `max` fica em 32 nos dois casos — mudança
pequena e localizada (só o piso sobe; nós já grandes por grau de conexão não
são afetados). `buildGraphLayout` ganhou um terceiro parâmetro opcional
(`options: GraphLayoutOptions = {}`, com `minNodeRadius`/`maxNodeRadius`)
que alimenta o clamp de raio existente — assinatura de 1 argumento
(`buildGraphLayout(data)`) continua válida (default idêntico ao
comportamento anterior), preservando os testes existentes.

Como o raio (`node.radius`) é compartilhado pelo layout usado tanto pelo
Sigma (`size: node.radius / 2.4`, `itemSizesReference: 'screen'` — ou seja,
tamanho em pixels de tela reais, não escalado por zoom) quanto pelo fallback
SVG, o bump de toque beneficia os dois caminhos WebGL-2D-e-abaixo. O canvas
3D/2D Reagraph (topo da cadeia de fallback) usa `node.weight` pro tamanho,
não `node.radius` — fora do escopo desta spec (não auditado; hit-testing do
Reagraph em touch não foi verificado, ver "Fora de Escopo").

**`resolveGraphViewBox(containerWidth, containerHeight): {width, height}`**
(nova função pura). Preserva a área do viewBox padrão (`1000 × 620 =
620000`) e resolve a proporção real do container, clampada entre
`MIN_VIEWBOX_ASPECT_RATIO = 0.4` e `MAX_VIEWBOX_ASPECT_RATIO = 2.5` (cobre
folgadamente qualquer celular/tablet/desktop real — retrato mais estreito
comum ~0.43, ultrawide comum ~2.1 — e só age em proporções patológicas, ex.:
sliver de devtools). Com largura ou altura não-positiva (não medido ainda),
retorna o padrão `{width:1000, height:620}`.

`BrainGraphSvg` mede seu próprio container via `getBoundingClientRect()` num
`useLayoutEffect` (medição síncrona antes do paint — evita flash com o
viewBox padrão) e um `ResizeObserver` pra resizes seguintes (rotação de
tela, etc.). Recalcula seu **próprio** layout via `buildGraphLayout(model.data,
{viewBox, minNodeRadius, maxNodeRadius})` — independente do layout usado
pelos canvases Reagraph/Sigma (que continuam com o viewBox padrão, já que
esses dois se auto-ajustam ao container via câmera/`fitNodesInView`/
`renderer.resize()`, não precisam de viewBox responsivo). `SigmaGraphModel`
ganhou um campo `data: GraphResp` (a entrada original/filtrada) pra permitir
esse recálculo independente sem replumbing de props adicional.

Efeito colateral desejado: como a proporção do viewBox agora bate com a do
container, o fator de escala do `preserveAspectRatio="xMidYMid meet"` deixa
de ser sub-utilizado em telas retrato — isso também aumenta o tamanho
renderizado (em px reais) dos nós no fallback SVG, complementando o bump de
`minNodeRadius` do problema 5.

`GraphLayout` ganhou um campo `viewBox: {width, height}` refletindo o valor
efetivamente usado — `buildSigmaGraphModel` passou a centralizar as
coordenadas do grafo Sigma a partir de `layout.viewBox` em vez da constante
`GRAPH_VIEWBOX` diretamente (mais correto/robusto para qualquer chamador
futuro que passe um `viewBox` customizado; sem mudança de comportamento nos
chamadores atuais, que sempre usam o viewBox padrão nesse caminho).

**Reestruturação da barra de controles (`GrafoPage`).** O container externo
virou `flex-col` com duas fileiras:

- Fileira primária (sempre visível): voltar, título (`hidden sm:flex`,
  inalterado), busca, toggle 2D/3D, atualizar — e, condicionalmente,
  `GraphStats` inline (`ml-auto hidden md:flex`, só desktop) **ou** um botão
  de informação icon-only (`size="icon"`, `md:hidden`, só mobile) que
  alterna `statsOpen`.
- Fileira secundária (mobile-only, condicional a `statsOpen`): painel com
  `GraphStats` completo, mesma linguagem visual da fileira primária
  (`rounded-2xl`, blur, borda, sombra).

`GraphStats` passou a receber `className` como prop obrigatória (sem
`display` baked-in no componente — só `flex-wrap items-center gap-3 ...`)
pra evitar qualquer ambiguidade de merge entre o `display` base e o
`hidden`/`flex` responsivo escolhido por cada call site. A decisão
desktop-vs-mobile da fileira de stats é 100% CSS (`hidden md:flex` /
`md:hidden`), consistente com o padrão já usado pelo título
(`hidden sm:flex`) — sem hook JS envolvido, ao contrário da decisão de
`is3d` (que precisa ser uma decisão de estado inicial, não só visual).
`aria-expanded` + `aria-controls`/`id` (via `useId()`) linkam o botão de
informação ao painel pra acessibilidade.

## Critérios de Aceite

- [x] `resolveDefaultIs3d(true)` → `true`; `resolveDefaultIs3d(false)` →
      `false`. Testado em `graph-mobile.test.ts`.
- [x] `resolveGraphViewBox(0,0)` (e negativos) → viewBox padrão
      `{width:1000,height:620}`. Testado.
- [x] `resolveGraphViewBox` produz um box retrato (altura > largura) pra
      container retrato, e paisagem (largura > altura) pra container
      paisagem largo, preservando a área padrão dentro de tolerância de
      arredondamento. Testado.
- [x] `resolveGraphViewBox` clampa proporções patológicas aos limites
      `MIN_VIEWBOX_ASPECT_RATIO`/`MAX_VIEWBOX_ASPECT_RATIO` em vez de
      produzir slivers extremos. Testado.
- [x] `resolveNodeRadiusBounds(false)` → `{min:13,max:32}`;
      `resolveNodeRadiusBounds(true)` → mínimo maior que 13, máximo
      inalterado (32). Testado.
- [x] `buildGraphLayout(data)` (1 argumento) continua funcionando com o
      comportamento/viewBox padrão anteriores — assinatura anterior
      preservada. Testado (testes pré-existentes de
      `graph-rendering.test.ts` continuam verdes).
- [x] `buildGraphLayout(data, {viewBox, minNodeRadius, maxNodeRadius})`
      honra os overrides — posições dentro do viewBox customizado, raios
      respeitando o novo piso. Testado.
- [x] `buildSigmaGraphModel(data, translate, layoutOptions)` repassa
      `layoutOptions` pro layout interno e expõe `data` no modelo
      retornado. Testado.
- [x] `make lint`, `make typecheck`, `bun test` (apps/web) verdes, com os
      testes pré-existentes de `buildGraphLayout`/`buildSigmaGraphModel`/
      `nodePath` intactos.
- [ ] Verificação visual no deploy (ver "Fora de Escopo" — Playwright
      desligado nesta entrega): barra de controles do grafo não quebra em
      múltiplas linhas de forma poluída no mobile; painel de estatísticas
      abre/fecha corretamente; câmera abre em 2D no mobile e 3D no desktop;
      fallback SVG (se acionado) não mostra faixas vazias grandes em tela
      retrato; nós são confortavelmente tocáveis no celular.

## Fora de Escopo

- **Verificação visual via Playwright** (desligada nesta entrega por
  decisão do owner — conferência acontece no deploy). Grafo é uma página
  particularmente visual (canvas WebGL, SVG, layout de força); os pontos
  que mais precisam de conferência visual real estão listados no critério
  de aceite final acima.
- **Hit-testing/tamanho de nós do canvas 3D/2D Reagraph.** O bump de raio
  de toque (problema 5) cobre os caminhos Sigma e SVG (que compartilham
  `node.radius` do layout); o Reagraph usa `node.weight` pro tamanho de nó e
  não foi auditado quanto a touch — se o owner reportar alvos pequenos
  especificamente no modo 3D/2D WebGL principal (não no fallback), é uma
  spec futura.
- **Rebalanceamento do algoritmo radial de layout por proporção.** A
  resposta a um viewBox retrato é reprojetar o mesmo algoritmo (raios/anéis
  em pixels absolutos) numa caixa de proporção diferente com área
  preservada — não um redesenho do algoritmo de distribuição em si (ex.:
  mais anéis concêntricos em vez de largos em telas altas). Suficiente pra
  resolver o problema relatado (faixas vazias), sem escopo extra.
- **Bottom sheet nativo/gestual pro painel de estatísticas.** Optou-se por
  um painel simples em fileira secundária (mesma linguagem visual da barra
  principal) em vez de um bottom sheet arrastável — mais simples de
  raciocinar sem verificação visual, e reaproveita um padrão já usado nesta
  mesma página em vez de introduzir um primitivo novo.
- Mudanças na colisão barra-do-grafo × `Topbar` (spec 079) — já corrigida,
  não reaberta aqui.
