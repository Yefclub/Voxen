---
tipo: ui
titulo: Indicador de ambiente substitui o alternador manual de canal em Novidades
---

A página Novidades tinha três botões (Todas/Produção/Dev) que pareciam alternar entre ambientes,
mas na verdade só filtravam o histórico de notas — a instância nunca trocava de canal, sempre
mostrava o mesmo `releases.json` da imagem atual. Esses botões saíram e o histórico completo passa
a aparecer direto, sem filtro manual. No lugar, um indicador simples e não-clicável no topo da
página mostra em qual ambiente a instância atual está rodando — Desenvolvimento ou Produção —
derivado da versão real reportada pelo servidor, sem depender de escolha manual do usuário.
