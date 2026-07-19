---
tipo: feat
título: Mapa do Brain rápido (2D padrão, recorte e arestas fortes)
---

- Abre o grafo em 2D por padrão e só carrega 3D sob demanda.
- `GET /api/graph?view=map` devolve um recorte enxuto (≤180 nós); `view=full` e `focus` cobrem o restante.
- Omite arestas fracas de co-ocorrência no mapa e eleva o limiar de RELATED_TO no indexador.
- Documenta LangExtract (padrão de grounding, sem a lib) e a estratégia do mapa em ADRs.
