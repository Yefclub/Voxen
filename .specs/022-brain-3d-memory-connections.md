# 022 — Brain 3D e conexões semânticas entre memórias

## Contexto

O Brain já materializa nós e arestas em Postgres, mas a experiência visual ainda
parece um painel estático quando comparada a mapas de conhecimento modernos. O
objetivo deste ciclo é aproximar a experiência de um grafo 3D force-directed:
nós vivos, conexões físicas, drag, câmera e foco visual, sem perder fallback para
ambientes sem WebGL.

A outra parte do problema é semântica. Um grafo bonito sem boas conexões vira
decoração. O Brain precisa conectar conteúdos entre si por conceitos
compartilhados, entidades recorrentes, wiki-links, pastas e evidências, mantendo
proveniência e remoção segura.

Pesquisa usada:

- `react-force-graph-3d` / `3d-force-graph` para grafo 3D force-directed em
  Three.js/WebGL.
- Three.js como runtime 3D.
- GraphRAG como referência arquitetural para entidades, relações, claims,
  comunidades e busca multi-hop com proveniência.
- LlamaIndex Property Graph como referência de extração incremental de entidades
  e relações em pipelines RAG.

## Decisões

- Usar `react-force-graph-3d` como superfície principal de `/grafo`.
- Manter o renderer Sigma/SVG como fallback quando o bundle 3D ou WebGL falhar.
- Preservar a resposta `/api/graph` atual para não quebrar MCP/chat; a melhoria
  visual deve consumir o contrato existente.
- Criar modelo 3D derivado no cliente, com links `source`/`target`, intensidade
  por confiança e partículas para relações de maior valor semântico.
- Reaquecer a simulação ao arrastar nós, permitindo que os conteúdos se
  reorganizem fisicamente.
- Ampliar o indexador determinístico antes de qualquer LLM extractor:
  - tópicos em transcrições e notas;
  - entidades heurísticas com baixa complexidade e alta explicabilidade;
  - relações `RELATED_TO` entre conteúdos por conceitos compartilhados;
  - deduplicação por chaves canônicas e evidência em `BrainSource`.
- Não introduzir Neo4j, pgvector obrigatório ou serviço externo neste ciclo.

## Critérios de aceite

- [x] `/grafo` renderiza uma superfície 3D interativa quando WebGL está
  disponível.
- [x] Nós podem ser arrastados e a simulação reage ao drag.
- [x] Seleção/hover destacam vizinhos e reduzem ruído visual do restante.
- [x] Clique no fundo limpa seleção; clique em nó atualiza o inspetor.
- [x] Há fallback 2D/SVG quando o renderer 3D falha.
- [x] Notas também geram tópicos e entidades no Brain.
- [x] Transcrições geram entidades além de tópicos.
- [x] Conteúdos ativos são conectados por `RELATED_TO/shared-concepts` quando
  compartilham conceitos relevantes.
- [x] Remoção/arquivamento de conteúdo remove evidências e conceitos órfãos
  automáticos.
- [x] Testes cobrem modelo 3D e novas conexões semânticas.
