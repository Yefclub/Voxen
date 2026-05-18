# Spec 006 — Graph View (visualização Obsidian-like)

**Status:** proposta (design only, sem implementação nesta PR)
**Owner:** Yef
**Created:** 2026-05-18
**Depends on:** 005 (notes), 002 (transcripts), 003 (chat-agno)

## Motivação

À medida que a KB cresce (transcripts + notas + futuras conexões), explorar
linearmente vira ineficiente. Visualização de grafo dá:

- Visão panorâmica do volume de conteúdo (clusters por tema)
- Descoberta de conexões inesperadas (cross-references)
- Navegação não-linear (clicar em nó → abrir)
- Heurística visual de "lacunas" (nós isolados, clusters densos)

Inspiração: Obsidian graph view (também usado por LogSeq, Roam).

## Requisitos (EARS)

### Ubiquitous

- O sistema DEVE renderizar todas as notas e transcrições do user logado como nós em um grafo.
- O sistema DEVE colorir nós por tipo (transcript YT/IG/TT/web vs note vs folder).
- O sistema DEVE permitir clique em nó pra abrir o detalhe (rota `/transcricoes/:id` ou `/notas/:id`).

### State-driven

- ENQUANTO o user pesquisa por termo no canto do grafo, o sistema DEVE realçar os nós que batem com FTS e atenuar os outros.

### Event-driven

- QUANDO o user clica em um nó, o sistema DEVE expandir vizinhos imediatos (até 2 hops).
- QUANDO um novo conteúdo é indexado (Job DONE ou nota criada), o grafo DEVE recarregar.

### Optional

- ONDE a quantidade de nós exceder 200, o sistema DEVE aplicar lazy rendering (renderizar apenas o vizinhança visível + edges).

### Unwanted

- SE não houver conteúdo (KB vazia), o sistema DEVE mostrar empty state com CTA pra criar primeira nota / transcrever vídeo.
- SE o navegador não suportar canvas/SVG WebGL, o sistema DEVE degradar pra lista textual.

## Arestas (edges) — descoberta automática

3 fontes de aresta:

1. **Wiki-links explícitas** — sintaxe `[[título da nota]]` no markdown da nota → aresta direta.
2. **Referências por id** — qualquer conteúdo que cite `transcript_id` ou `note_id` → aresta.
3. **Similaridade FTS** — top-3 vizinhos por `ts_rank` do title+content (off por default, opt-in).

Edge weight = inverso da distância de similaridade. Grosso = mais similar.

## Tecnologia

| Opção | Prós | Contras |
|---|---|---|
| **react-flow** | API React-native, fácil customização de nós, boa perf até ~500 nós | Não tem layout força-direcionado out-of-the-box (precisa plugin Dagre/Elk) |
| **cytoscape.js** | Algoritmos de layout incluídos (cose-bilkent, fcose), perf melhor | API imperativa, integração React via wrapper |
| **vis-network** | Layout física simulada nativa, simples API | Menos manutenção ativa, perf menor |
| **D3 + force** | Total controle | Trabalho enorme pra UI/UX decente |

**Recomendação**: cytoscape.js (algoritmos prontos + perf comprovada em KBs grandes do Obsidian).

## Endpoints novos

```
GET /api/graph
  → { nodes: [{id, label, type, weight}], edges: [{from, to, weight}] }
  Limite default: 500 nós (paginação por densidade não relevante).
```

Servidor calcula:
- Edges wiki-link (regex `\[\[([^\]]+)\]\]` no content das notas)
- Edges id-reference (regex `transcript[_-]?id["\']?:\s*["\']?([a-z0-9]{8,})`)
- Edges FTS similarity (se setting `graph_fts_edges=true`): para cada nó N, top-3 vizinhos onde N.tsvector matches algum termo de outro.

## UI

- Rota `/grafo`
- Sidebar com filtros (toggle types, search box, layout selector)
- Grafo full-bleed à direita
- Click nó: tooltip com preview + botão "Abrir"
- Hover edge: mostra peso

## Trade-offs / não-fazer

- ❌ **Não rodar em mobile** — toque + pan + zoom + grafo grande é horrível em <768px; só desktop.
- ❌ **Não regenerar edges em tempo-real** — calcula no GET, cache simples 60s em Redis (key `voxen:graph:<userId>`).
- ❌ **Não fazer 3D** — bonito mas complica perf e acessibilidade.

## Tarefas pra implementação (futura PR)

1. Migration: nada novo (edges são calculadas, não armazenadas)
2. Endpoint `GET /api/graph` (web)
3. Lib client wrapper de cytoscape (`apps/web/src/client/lib/graph.ts`)
4. Página `/grafo` (`apps/web/src/client/pages/grafo.tsx`)
5. Item "Grafo" na sidebar
6. Hover/click handlers
7. Testes: parser wiki-links, parser id-references
8. Documentar em README a sintaxe `[[link]]` esperada nas notas

## Critério de pronto

- KB com 50 transcripts + 20 notas → grafo renderiza em <1s no chrome moderno
- Click em nota com `[[outra]]` mostra aresta pra "outra"
- Search no canto destaca corretamente
- Sem GC pauses visíveis no dev-tools timeline com 200 nós

---

**Não implementado nesta PR. Spec criada pra capturar o pensamento; abrir como PR separada quando priorizar.**
