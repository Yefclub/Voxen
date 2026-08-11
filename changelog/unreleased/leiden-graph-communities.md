---
tipo: feat
titulo_en: Knowledge graph communities now reveal cohesive themes
titulo_pt_br: Comunidades do grafo agora revelam temas coesos
---

Voxen now detects weighted Leiden communities in each authorized knowledge-graph view. Confidence, evidence quality, and relationship semantics influence the partition, so a weak bridge no longer collapses two dense themes into one group. The graph API also reports deterministic algorithm metadata and explainable cohesion metrics, while the 2D and 3D views use the same server partition.

Isolated nodes remain visible without being promoted as meaningful themes. If Leiden cannot run, the graph remains available through a deterministic connected-components fallback identified in the response.

<!-- pt-BR -->

A Voxen agora detecta comunidades Leiden ponderadas em cada visão autorizada do grafo de conhecimento. Confiança, qualidade da evidência e semântica das relações influenciam a partição; assim, uma ponte fraca não transforma mais dois temas densos em um único grupo. A API do grafo também informa metadados determinísticos do algoritmo e métricas explicáveis de coesão, enquanto as visões 2D e 3D usam a mesma partição calculada pelo servidor.

Nós isolados continuam visíveis sem serem promovidos a temas relevantes. Se o Leiden não puder ser executado, o grafo permanece disponível por meio de um fallback determinístico por componentes conexos, identificado na resposta.
