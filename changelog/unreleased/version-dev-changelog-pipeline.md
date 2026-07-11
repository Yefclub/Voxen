---
tipo: infra
titulo: Versionamento automático em dev e changelog por PR
---

A cada merge em `dev`, o Voxen agora grava a versão no `package.json` no formato
`X.Y.Z-dev.<timestamp>` (commit `chore: set version to … for dev`), no mesmo
estilo da Orbital.

Além disso, cada PR de produto passa a incluir um arquivo em
`changelog/unreleased/` com a nota para o usuário final. No merge, a nota entra
em `releases.json` e no `CHANGELOG.md` — base da página de Novidades.
