---
tipo: chore
título: Deploy manual e commits de versão limpos em dev
---

- Imagem Easypanel deixa de ser publicada em todo push de `dev` (só tag de release ou `workflow_dispatch`).
- Bump de versão em dev passa a commitar/squashar como `set version to X.Y.Z-dev.<ts>` (sem `chore:`/`for dev`/`(#N)` no subject do squash).
- Script de deploy Easypanel documentado como manual (sem hook pós-pull).
