---
tipo: fix
titulo: Correção do detector de PR de versão aberta
---

O workflow de versionamento em dev não criava a PR de bump porque a busca
de PRs abertas era ampla demais. Agora só considera títulos que começam com
`chore: set version to `.
