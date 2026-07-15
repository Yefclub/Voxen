# Spec 098 — Experiência e desempenho do Voxen Brain

## Status

Aprovada pelo owner em 2026-07-15 por pedido direto de reformulação visual e
de desempenho da página `/grafo`, com merge autorizado para `dev`.

Revisada em 2026-07-15 após o owner confirmar que a experiência principal deve
continuar 3D, porém com qualidade visual e eficiência substancialmente maiores.

Revisada novamente em 2026-07-15 por pedido direto do owner para encerrar o
ciclo infinito de carregamento, tornar a coordenação da indexação resiliente a
reinícios e corrigir o enquadramento do grafo 3D.

## Contexto

O mapa do Voxen Brain oferece os dados necessários para explorar a base de
conhecimento, mas a implementação 3D atual executa uma simulação de força
custosa, demora para estabilizar e recria o renderer quando dados ou tema mudam.
Esse ciclo acumula contextos WebGL, degrada pan, zoom e rotação e pode terminar
em perda do contexto ou framebuffer inválido. O fallback Sigma também repassa o
tipo semântico do nó como chave de programa gráfico, causando falha para tipos
como `topic`.

Esta entrega transforma o grafo em uma superfície de exploração 3D persistente:
posições tridimensionais determinísticas por comunidade, câmera orbital, leitura
de hubs, filtros, inspeção contextual e adaptação de detalhes à densidade. O
mesmo canvas permanece montado durante busca, seleção, atualização e troca de
tema. O renderer 2D existe apenas como fallback explícito ou automático.

Após a primeira entrega, o cliente continuou buscando o snapshot completo a
cada 1,8 segundo enquanto `indexing=true`. Cada resposta recriava o modelo de
nós e arestas e gerava milhares de atualizações visuais e avisos de cor. O
controle de concorrência da indexação também permanecia restrito à memória de
um processo, perdendo o estado em reinícios. Esta revisão separa snapshot e
status, torna a coordenação distribuída e deixa falhas observáveis e terminais.

## Glossário

- **Hub**: nó com muitas conexões no conjunto visível.
- **Comunidade**: grupo de nós conectados por relações do Brain.
- **Visão principal**: renderer 3D aberto automaticamente ao entrar na página.
- **Renderer persistente**: instância WebGL que recebe atualizações sem remontar
  o canvas ou criar um novo contexto gráfico.
- **Perfil visual**: conjunto adaptativo de rótulos, curvas e animações aplicado
  conforme o tamanho do grafo.
- **Indexação**: atualização dos nós e relações derivados das fontes da
  biblioteca.
- **Snapshot**: conjunto materializado e estável de nós e relações entregue ao
  renderer.
- **Lease**: posse temporária e renovável da indexação de um workspace, com
  expiração automática se o processo parar.

## Requisitos

### Ubiquitous

- The system shall abrir o Voxen Brain em uma visão 3D navegável e responsiva.
- The system shall manter a visão 2D disponível como fallback manual e
  automático quando o 3D não puder ser inicializado.
- The system shall posicionar os nós em três dimensões de forma determinística,
  agrupando comunidades sem simulação contínua no thread da interface.
- The system shall manter uma única instância do canvas WebGL enquanto a página
  e o modo 3D permanecerem montados.
- The system shall usar as cores semânticas do tema ativo no fundo, painéis,
  textos, nós, arestas, estados de foco e fallbacks do grafo.
- The system shall apresentar contagens de nós, relações e comunidades, além
  dos hubs mais relevantes do conjunto visível.
- The system shall oferecer busca, filtros por tipo, rotação, zoom,
  reenquadramento e inspeção de um nó sem exigir navegação para outra página.
- The system shall manter o limite defensivo atual de 500 nós e 1.500 relações
  por workspace.
- The system shall manter o snapshot do grafo separado do estado de indexação,
  permitindo que a superfície permaneça pronta e interativa durante trabalho em
  background.
- The system shall coordenar uma única indexação por workspace com estado
  compartilhado e lease que sobreviva à troca de processo.
- The system shall manter o centro geométrico das coordenadas 3D na origem e
  enquadrar o conjunto inteiro quando uma topologia nova for apresentada.

### Event-driven

- When o usuário pesquisa ou altera um filtro, the system shall atualizar o
  conjunto visível e remover relações cujas duas pontas não estejam visíveis
  sem desmontar o renderer ativo.
- When o usuário troca o tema, the system shall atualizar a paleta do canvas
  existente sem criar um novo contexto WebGL.
- When o usuário seleciona um nó, the system shall destacar sua vizinhança,
  centralizá-lo e apresentar seus metadados, conexões e ação de abertura da
  fonte quando houver uma rota correspondente.
- When o número de nós ou relações aumenta, the system shall reduzir animações,
  curvatura e densidade de rótulos de acordo com um perfil visual previsível.
- When o usuário solicita atualização do grafo, the system shall buscar o
  estado materializado mais recente sem aguardar uma reindexação completa da
  biblioteca dentro da resposta HTTP.
- When a cobertura do Brain estiver ausente ou desatualizada, the system shall
  iniciar a reindexação em background e informar esse estado na resposta.
- When a reindexação estiver em andamento, the system shall atualizar a página
  automaticamente até que o estado materializado novo esteja disponível.
- When a reindexação estiver em andamento, the system shall consultar somente
  seu estado leve e buscar o snapshot completo uma única vez após a conclusão.
- When o processo responsável pela indexação parar, the system shall liberar a
  posse por expiração e permitir retomada posterior sem duas execuções ativas.
- When a indexação falhar ou terminar com cobertura incompleta, the system shall
  encerrar o estado de progresso, preservar o snapshot utilizável e aplicar um
  intervalo antes de nova tentativa automática.
- When o usuário solicitar reenquadramento, the system shall centralizar e
  ajustar a câmera para todos os nós visíveis.

### State-driven

- While o usuário move, amplia ou rotaciona o grafo 3D, the system shall evitar
  simulação contínua e reduzir trabalho visual dispensável para preservar
  fluidez.
- While um nó estiver selecionado ou sob o ponteiro, the system shall realçar
  esse nó e seus vizinhos e reduzir visualmente os demais.
- While a indexação estiver em andamento, the system shall manter o grafo
  existente interativo e exibir feedback não bloqueante.
- While uma indexação distribuída estiver ativa, the system shall renovar sua
  posse periodicamente e impedir que outra instância inicie o mesmo trabalho.
- While a página estiver em viewport estreita, the system shall manter os
  controles essenciais acessíveis e apresentar painéis de exploração e
  inspeção como superfícies sobrepostas que não comprimem o canvas.

### Optional

- Where WebGL2 não estiver disponível ou o contexto 3D falhar, the system shall
  apresentar a visão 2D e, se necessário, um fallback SVG navegável com o mesmo
  conjunto filtrado e cores compatíveis com o tema.

### Unwanted behavior

- If a biblioteca exigir reindexação, then the system shall not executar a
  reindexação completa de forma síncrona no GET do grafo.
- If o usuário digitar rapidamente na busca, trocar filtros ou alternar tema,
  then the system shall not remontar o renderer 3D nem acumular contextos
  WebGL.
- If o tipo semântico de um nó for `topic`, `entity`, `note` ou outro tipo do
  Brain, then the system shall not usá-lo como chave de programa do Sigma.
- If o tema ativo for light, then the system shall not usar fundo, rótulos ou
  contornos fixos do tema escuro.
- If a indexação continuar ativa, then the system shall not reenviar o snapshot
  completo nem reconstruir nós e arestas a cada consulta de progresso.
- If uma execução não conseguir indexar todas as fontes, then the system shall
  not iniciar outra execução imediatamente em ciclo infinito.
- If uma cor com transparência for usada no renderer 2D, then the system shall
  not repassar seu canal alpha para APIs 3D que aceitam apenas RGB.
- If um nó ou relação não pertencer ao workspace autenticado, then the system
  shall not incluí-lo na resposta ou no conjunto visível.

## Critérios de Aceite

- [x] A entrada em `/grafo` monta a visão 3D primeiro e mantém o mesmo
      `GraphCanvas` durante busca, filtros, seleção e troca de tema.
- [x] O layout 3D determinístico agrupa comunidades, produz coordenadas
      `x/y/z` finitas para 500 nós e não depende de simulação contínua.
- [x] O perfil visual reduz trabalho de arestas, rótulos, animações e arraste
      em grafos médios e grandes.
- [x] A detecção de WebGL2 é executada uma vez, libera seu contexto de teste e
      falhas reais de criação ou perda acionam o fallback.
- [x] As opções de contexto do renderer priorizam desempenho e prevalecem sobre
      os defaults da dependência Reagraph.
- [x] O fallback Sigma usa um programa gráfico registrado e preserva o tipo
      semântico em atributo separado.
- [x] O GET do grafo nunca aguarda reindexação completa e retorna `indexing`
      para permitir feedback e atualização automática.
- [x] Busca e filtros preservam apenas nós correspondentes (e vizinhos da
      busca) e relações com as duas pontas visíveis.
- [x] Seleção, hover, zoom e reenquadramento funcionam e a inspeção lista
      conexões navegáveis.
- [x] A página exibe visão geral, hubs e comunidades e continua utilizável em
      viewport estreita.
- [x] Os temas zinc, emerald e light produzem paletas de canvas legíveis e o
      fundo da página acompanha `--color-app-bg`.
- [x] Testes de helpers, rota, lint, typecheck, testes web e build Vite ficam
      verdes.
- [x] O status da indexação usa lease compartilhado com token, expiração,
      renovação e liberação condicionada ao owner correto.
- [x] O cliente consulta um endpoint de status durante o trabalho e não altera
      as props de nós/arestas do `GraphCanvas` até o snapshot final.
- [x] Falha, processo interrompido e cobertura incompleta terminam ou retomam o
      fluxo sem polling de snapshot ou reindexação infinita.
- [x] Todas as cores enviadas ao renderer 3D são RGB opacas, sem avisos repetidos
      sobre componentes alpha ignorados.
- [x] As posições 3D têm limites centralizados na origem e a câmera reenquadra
      todos os nós ao receber uma topologia nova.
- [x] Testes cobrem lease/status, polling terminal, cores 3D, centralização,
      lifecycle do canvas, lint, typecheck e build Vite.

## Fora de Escopo

- Alterar a modelagem Prisma ou a extração semântica do Brain.
- Aumentar os limites de 500 nós e 1.500 relações.
- Editar relações diretamente pelo canvas.
- Subir Docker ou executar Playwright nesta entrega, conforme regra explícita
  do owner para este chat.

## Riscos / Decisões pendentes

- A posição determinística privilegia estabilidade e resposta imediata; ela não
  tenta reproduzir uma simulação física após cada alteração.
- A validação visual automatizada fica impedida pela restrição desta entrega;
  o layout será coberto por funções puras, testes e build, e a inspeção final
  no deploy continua necessária.

> 2026-07-15: contrato revisado porque o owner confirmou que o 3D deve ser a
> experiência principal, com renderer persistente e desempenho previsível.

> 2026-07-15: contrato revisado para separar status e snapshot, coordenar a
> indexação por lease compartilhado e garantir enquadramento centralizado.
