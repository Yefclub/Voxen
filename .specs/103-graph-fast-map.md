# Spec 103 — Mapa rápido do Brain (2D-first + slice + arestas fortes)

## Contexto

O `/grafo` carrega o snapshot quase completo e abre em 3D por padrão, com arestas
de co-ocorrência lexical fracas. O mercado OSS de second-brain (Obsidian, Sigma,
AnythingLLM) privilegia mapa **rápido**, visão local e ligações explicáveis.
Esta spec redefine a experiência padrão sem abandonar o 3D opcional nem o full dump.

LangExtract (Google, Apache-2.0) inspira **extração estruturada com grounding**
na ingestão, mas a integração da lib fica fora desta entrega (ver ADR-011).

## Glossário

- **Map view**: recorte padrão do grafo para UI (conteúdos, pastas, hubs, arestas fortes).
- **Full view**: snapshot amplo (limites defensivos atuais).
- **Focus view**: ego-network a N hops a partir de um nó.
- **Aresta forte**: wikilink, pasta/hierarquia, ou RELATED_TO com confiança alta.

## Requisitos

### Ubiquitous

- The system shall abrir `/grafo` em modo **2D** por padrão.
- The system shall expor `GET /api/graph` com `view=map|full` (default `map`).
- The system shall aplicar limites de map view: no máximo 180 nós e 400 arestas.
- The system shall manter full view com os limites defensivos de 500 nós e 1500 arestas.
- The system shall permitir toggle 2D/3D sem perder seleção.

### Event-driven

- When `view=map`, the system shall priorizar nós de conteúdo/nota/pasta e só
  incluir tópicos/entidades com grau ≥ 2 no conjunto candidatado.
- When `view=map`, the system shall omitir arestas RELATED_TO/MENTIONS com
  confiança &lt; 0.55 e método fraco (keyword, shared-concepts, semantic-profile,
  timeline-adjacent), mantendo wikilink/folder/belongs_to.
- When `focus=<nodeId>` for informado, the system shall retornar a vizinhança a
  `hops` hops (default 1, max 2) em vez do mapa global.
- When o usuário pedir mapa completo na UI, the system shall solicitar `view=full`.

### State-driven

- While o modo for 2D, the system shall não carregar o bundle 3D (Reagraph) até
  o usuário alternar para 3D.

### Unwanted

- If o focus id não existir, then the system shall responder com mapa vazio de
  nós/arestas e `truncated=false` sem erro 500.
- If o grafo map for truncado, then the system shall sinalizar `truncated: true`
  e contagens totais candidatas.

## Critérios de Aceite

- [ ] Default `DEFAULT_GRAPH_MODE === '2d'`.
- [ ] `view=map` retorna ≤180 nós e ≤400 arestas e filtra arestas fracas.
- [ ] `focus` + `hops` devolve ego-network.
- [ ] UI usa map por padrão e permite full.
- [ ] Testes unitários cobrem o slice e o default 2D.
- [ ] Limiar de RELATED_TO no indexador Brain elevado (menos arestas cosméticas).

## Fora de Escopo

- Integrar a biblioteca LangExtract no worker.
- Embeddings / pgvector.
- Neo4j ou layout server-side GPU.

## Riscos / Decisões

- Map view pode esconder tópicos isolados — intencional (ruído).
- Full view permanece para debugging e bases pequenas.
