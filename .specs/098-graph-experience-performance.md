# Spec 098 — Experiência e desempenho do Voxen Brain

## Status

Aprovada pelo owner em 2026-07-15 por pedido direto de reformulação visual e
de desempenho da página `/grafo`, com merge autorizado para `dev`.

## Contexto

O mapa do Voxen Brain oferece os dados necessários para explorar a base de
conhecimento, mas a experiência atual prioriza uma visualização 3D custosa,
demora para apresentar conteúdo em alguns estados de indexação, perde fluidez
durante pan/zoom e não oferece ferramentas suficientes para compreender o que
está sendo mostrado. A página também usa cores fixas de tema escuro em partes
do canvas, quebrando a continuidade visual dos temas zinc, emerald e light.

Esta entrega transforma o grafo em uma superfície de exploração: visão 2D
rápida como padrão, leitura de comunidades e hubs, filtros, inspeção contextual
e feedback explícito de indexação. O modo 3D continua disponível como uma visão
opcional carregada somente quando solicitado.

## Glossário

- **Hub**: nó com muitas conexões no conjunto visível.
- **Comunidade**: grupo de nós conectados por relações do Brain.
- **Visão principal**: renderer 2D aberto automaticamente ao entrar na página.
- **Indexação**: atualização dos nós e relações derivados das fontes da
  biblioteca.

## Requisitos

### Ubiquitous

- The system shall abrir o Voxen Brain em uma visão 2D navegável e responsiva.
- The system shall manter o modo 3D disponível somente como ação opcional do
  usuário.
- The system shall usar as cores semânticas do tema ativo no fundo, painéis,
  textos, nós, arestas, estados de foco e fallbacks do grafo.
- The system shall apresentar contagens de nós, relações e comunidades, além
  dos hubs mais relevantes do conjunto visível.
- The system shall oferecer busca, filtros por tipo, zoom, reenquadramento e
  inspeção de um nó sem exigir navegação para outra página.
- The system shall manter o limite defensivo atual de 500 nós e 1.500 relações
  por workspace.

### Event-driven

- When o usuário pesquisa ou altera um filtro, the system shall atualizar o
  conjunto visível e remover relações cujas duas pontas não estejam visíveis.
- When o usuário seleciona um nó, the system shall destacar sua vizinhança,
  centralizá-lo e apresentar seus metadados, conexões e ação de abertura da
  fonte quando houver uma rota correspondente.
- When o usuário solicita a visão 3D, the system shall carregar seus recursos
  sob demanda sem bloquear a abertura inicial da visão 2D.
- When o usuário solicita atualização do grafo, the system shall buscar o
  estado materializado mais recente sem aguardar uma reindexação completa da
  biblioteca dentro da resposta HTTP.
- When a cobertura do Brain estiver ausente ou desatualizada, the system shall
  iniciar a reindexação em background e informar esse estado na resposta.
- When a reindexação estiver em andamento, the system shall atualizar a página
  automaticamente até que o estado materializado novo esteja disponível.

### State-driven

- While o usuário move ou amplia o grafo 2D, the system shall reduzir trabalho
  visual dispensável para preservar fluidez.
- While um nó estiver selecionado ou sob o ponteiro, the system shall realçar
  esse nó e seus vizinhos e reduzir visualmente os demais.
- While a indexação estiver em andamento, the system shall manter o grafo
  existente interativo e exibir feedback não bloqueante.
- While a página estiver em viewport estreita, the system shall manter os
  controles essenciais acessíveis e apresentar painéis de exploração e
  inspeção como superfícies sobrepostas que não comprimem o canvas.

### Optional

- Where WebGL não estiver disponível, the system shall apresentar um fallback
  SVG navegável com o mesmo conjunto filtrado de dados e cores compatíveis com
  o tema.

### Unwanted behavior

- If a biblioteca exigir reindexação, then the system shall not executar a
  reindexação completa de forma síncrona no GET do grafo.
- If o usuário digitar rapidamente na busca, then the system shall not remontar
  o renderer para cada evento de teclado antes da consulta estabilizar.
- If o tema ativo for light, then the system shall not usar fundo, rótulos ou
  contornos fixos do tema escuro.
- If um nó ou relação não pertencer ao workspace autenticado, then the system
  shall not incluí-lo na resposta ou no conjunto visível.

## Critérios de Aceite

- [x] A entrada em `/grafo` monta a visão Sigma 2D primeiro; o chunk 3D é
      solicitado apenas após ação explícita do usuário.
- [x] O GET do grafo nunca aguarda reindexação completa e retorna `indexing`
      para permitir feedback e atualização automática.
- [x] Busca e filtros preservam apenas nós correspondentes (e vizinhos da
      busca) e relações com as duas pontas visíveis.
- [x] A disposição determinística agrupa comunidades e produz coordenadas
      finitas para o limite de 500 nós sem simulação contínua no thread da UI.
- [x] Seleção, hover, zoom e reenquadramento funcionam no renderer 2D e a
      inspeção lista conexões navegáveis.
- [x] A página exibe visão geral, hubs e comunidades e continua utilizável em
      viewport estreita.
- [x] Os temas zinc, emerald e light produzem paletas de canvas legíveis e o
      fundo da página acompanha `--color-app-bg`.
- [x] O fallback SVG continua disponível quando WebGL falha.
- [x] Testes de helpers, rota, lint, typecheck, testes web e build Vite ficam
      verdes.

## Fora de Escopo

- Alterar a modelagem Prisma ou a extração semântica do Brain.
- Aumentar os limites de 500 nós e 1.500 relações.
- Editar relações diretamente pelo canvas.
- Subir Docker ou executar Playwright nesta entrega, conforme regra explícita
  do owner para este chat.

## Riscos / Decisões pendentes

- O modo 3D permanece útil como exploração opcional, mas não é o caminho de
  desempenho principal.
- A validação visual automatizada fica impedida pela restrição desta entrega;
  o layout será coberto por funções puras, testes e build, e a inspeção final
  no deploy continua necessária.
