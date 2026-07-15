# Spec 098 — Experiência e desempenho do Voxen Brain

## Status

Aprovada pelo owner em 2026-07-15 por pedido direto de reformulação visual e
de desempenho da página `/grafo`, com merge autorizado para `dev`.

Revisada em 2026-07-15 após o owner confirmar que a experiência principal deve
continuar 3D, porém com qualidade visual e eficiência substancialmente maiores.

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

### State-driven

- While o usuário move, amplia ou rotaciona o grafo 3D, the system shall evitar
  simulação contínua e reduzir trabalho visual dispensável para preservar
  fluidez.
- While um nó estiver selecionado ou sob o ponteiro, the system shall realçar
  esse nó e seus vizinhos e reduzir visualmente os demais.
- While a indexação estiver em andamento, the system shall manter o grafo
  existente interativo e exibir feedback não bloqueante.
- While a página estiver em viewport estreita, the system shall manter os
  controles essenciais acessíveis e apresentar painéis de exploração e
  inspeção como superfícies sobrepostas que não comprimem o canvas.

### Optional

- Where WebGL não estiver disponível ou o contexto 3D falhar, the system shall
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
- If um nó ou relação não pertencer ao workspace autenticado, then the system
  shall not incluí-lo na resposta ou no conjunto visível.

## Critérios de Aceite

- [x] A entrada em `/grafo` monta a visão 3D primeiro e mantém o mesmo
      `GraphCanvas` durante busca, filtros, seleção e troca de tema.
- [x] O layout 3D determinístico agrupa comunidades, produz coordenadas
      `x/y/z` finitas para 500 nós e não depende de simulação contínua.
- [x] O perfil visual reduz trabalho de arestas, rótulos, animações e arraste
      em grafos médios e grandes.
- [x] A detecção de WebGL é executada uma vez e libera seu contexto de teste.
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
