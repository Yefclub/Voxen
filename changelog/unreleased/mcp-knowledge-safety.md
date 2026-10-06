---
tipo: fix
titulo_en: MCP graph paths and evidence stay consistent
titulo_pt_br: Caminhos e evidências do MCP mais consistentes
---

MCP graph paths now preserve the requested endpoints and show traversal order
when relationships are stored in the opposite direction. Queries exclude
cyclic walks and use a bounded execution deadline.

Archived graph queries exclude trash, and evidence checks verify the current
owner, source version and research state. Read-only research tools report
freshness without changing research records or deleting graph projections.

Update vulnerable transitive dependencies identified by the delivery security audits: source-map-js, proxy-addr and multidict.

<!-- pt-BR -->

Os caminhos do grafo pelo MCP preservam os pontos solicitados e mostram a ordem
de navegação mesmo quando as relações estão armazenadas na direção oposta. As
consultas excluem ciclos e têm um limite de execução.

As consultas de arquivados excluem a lixeira, e as evidências verificam o dono,
a versão da fonte e o estado da pesquisa. As ferramentas de leitura informam a
atualidade da pesquisa sem modificar seus registros ou apagar partes do grafo.

Atualiza as dependências transitivas source-map-js, proxy-addr e multidict, com correções de segurança identificadas durante a entrega.
