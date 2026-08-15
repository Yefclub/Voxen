---
tipo: fix
titulo_en: Ingestions now recover without stale failures
titulo_pt_br: Ingestões agora se recuperam sem falhas obsoletas
---

The processing queue now retries temporary Brain contention and automatically
clears resolved warnings without repeating the canonical ingestion. Research
enrichment no longer changes a completed ingestion into a failure, while X,
TikTok, and OpenRouter errors provide safer and more actionable guidance.

<!-- pt-BR -->

A fila de processamento agora repete contenções temporárias do Brain e remove
automaticamente avisos já resolvidos sem refazer a ingestão canônica. A pesquisa
complementar não transforma mais uma ingestão concluída em falha, enquanto erros
do X, TikTok e OpenRouter oferecem orientações mais seguras e acionáveis.
