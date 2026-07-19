---
tipo: security
titulo: Atualizações de segurança em dependências transitivas
---

Corrige alertas do Dependabot em dependências de build e do worker:

- `shell-quote` 1.8.4 (crítico, dev)
- `js-yaml` 4.2.0 e `@babel/core` 7.29.6 (tooling)
- `aiohttp` ≥ 3.14.1 no worker (transitiva do S3/scraper)
