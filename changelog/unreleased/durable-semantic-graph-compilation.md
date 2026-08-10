---
tipo: fix
titulo_en: Semantic graph indexing now recovers automatically
titulo_pt_br: A indexação semântica do grafo agora se recupera automaticamente
---

Semantic graph extraction now resumes after temporary worker, provider, or graph-lock
interruptions instead of leaving transcript concepts and relationships pending indefinitely.
Graph status also distinguishes source-node coverage from semantic segment progress, making
pending, retrying, completed, skipped, and terminal work observable.

<!-- pt-BR -->

A extração semântica do grafo agora é retomada após interrupções temporárias do worker, do
provedor ou do bloqueio de escrita, evitando que conceitos e relações das transcrições fiquem
pendentes indefinidamente. O status do grafo também separa a cobertura dos conteúdos da
evolução dos segmentos semânticos, tornando visíveis os trabalhos pendentes, em nova tentativa,
concluídos, ignorados e encerrados com falha.
