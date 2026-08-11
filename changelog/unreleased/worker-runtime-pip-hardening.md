---
tipo: security
titulo_en: Smaller worker runtime attack surface
titulo_pt_br: Menor superfície de ataque no runtime do worker
---

The production worker image no longer includes the unused global Python package
installer and its vendored dependencies. Runtime dependencies remain locked in
the uv-managed virtual environment, while image vulnerability scans now inspect
only packages that the worker can execute.

<!-- pt-BR -->

A imagem de produção do worker não inclui mais o instalador global de pacotes
Python, que não era utilizado, nem suas dependências incorporadas. As
dependências de runtime continuam travadas no ambiente virtual gerenciado pelo
uv, enquanto a análise de vulnerabilidades passa a considerar somente os
pacotes que o worker pode executar.
