---
tipo: infra
titulo: Script de deploy automático no Easypanel pós-merge
---

Adicionado `scripts/easypanel-deploy.sh`: dispara o redeploy do `voxen-app` no Easypanel quando a `dev` avança para um SHA ainda não implantado, idempotente (marcador em disco evita redeploy duplicado do mesmo commit), com modo `--dry-run` e retentativa curta em falha transitória do Easypanel. O script não contém nenhuma credencial — a API key vem do ambiente. A configuração do gatilho (hook local que chama este script após cada merge) é feita separadamente, fora do controle de versão.
