---
tipo: infra
titulo_en: New capture worker container for link capture
titulo_pt_br: Novo container de captura para links
---

Voxen now ships a `capture-worker` service that downloads and extracts content from web pages, YouTube, TikTok, Instagram, X posts and uploaded files. It runs isolated: it holds no encryption key, no AI provider keys and no database access, and every outbound request goes through a built-in egress filter that blocks private and internal addresses. `make ensure-env` generates its access token. The capture screens that use it arrive in a later release; the knowledge base keeps working without it.

<!-- pt-BR -->

A Voxen agora inclui o serviço `capture-worker`, que baixa e extrai o conteúdo de páginas web, YouTube, TikTok, Instagram, posts do X e arquivos enviados. Ele roda isolado: não guarda chave de criptografia, chaves de provedores de IA nem acesso ao banco, e toda requisição de saída passa por um filtro embutido que bloqueia endereços privados e internos. O `make ensure-env` gera o token de acesso. As telas de captura que usam o serviço chegam numa próxima versão; a base continua funcionando sem ele.
