---
tipo: ui
titulo: Grafo do Brain mais leve e fluido
---

A visualização do **Voxen Brain** (`/grafo`) passou a usar a Reagraph, um
motor WebGL 2D. O grafo fica mais limpo e fácil de navegar (pan e zoom diretos,
destaque de vizinhança ao passar o mouse, clique para selecionar e duplo-clique
para abrir o item). O motor pesado é carregado só ao abrir a página, deixando o
resto do app mais rápido para carregar. Quando o navegador não tem WebGL, o
grafo continua caindo no desenho 2D determinístico de sempre.
