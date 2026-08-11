---
tipo: feat
titulo_en: Weighted graph importance shaped by durable interests
titulo_pt_br: Importância ponderada do grafo guiada por interesses duráveis
---

The knowledge graph now distinguishes raw connection count from weighted
importance. It calculates weighted degree, structural PageRank, and a separate
Personalized PageRank based only on the signed-in user's positive durable
interest projections.

Graph hubs now prioritize stronger, better-supported relationships instead of
treating every edge equally. When no personal seed is available in the visible
graph, Voxen uses an explicit uniform fallback. Algorithm version, convergence,
projection watermark, seed counts, and snapshot truncation remain inspectable
without exposing another user's interests.

<!-- pt-BR -->

O grafo de conhecimento agora diferencia a quantidade bruta de conexões da
importância ponderada. Ele calcula grau ponderado, PageRank estrutural e um
Personalized PageRank separado, baseado apenas nas projeções positivas de
interesse durável do usuário autenticado.

Os hubs do grafo passam a priorizar relações mais fortes e bem fundamentadas,
em vez de tratar todas as arestas como equivalentes. Quando não há uma semente
pessoal no recorte visível, a Voxen usa um fallback uniforme explícito. Versão
do algoritmo, convergência, watermark da projeção, quantidade de sementes e
truncamento do recorte continuam inspecionáveis sem expor interesses de outro
usuário.
