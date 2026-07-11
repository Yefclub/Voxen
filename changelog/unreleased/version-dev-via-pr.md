---
tipo: fix
titulo: Versionamento em dev via PR (compatível com branch protection)
---

O bump automático `X.Y.Z-dev.timestamp` agora abre uma PR de versão e usa
auto-merge, respeitando a proteção da branch `dev` (sem push direto).
