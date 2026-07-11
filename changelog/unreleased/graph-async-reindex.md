---
tipo: fix
titulo: Grafo carrega sem travar (fim do erro 502)
---

Abrir o grafo do Brain deixou de recalcular a base inteira de forma síncrona
dentro da requisição — o que, em bibliotecas grandes, travava por dezenas de
segundos e resultava em erro 502. Agora a página responde na hora com o estado
atual e, quando há muito conteúdo para reindexar, o recálculo roda em segundo
plano; o grafo se atualiza sozinho no próximo carregamento.
