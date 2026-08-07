---
tipo: infra
titulo_en: New self-hosted installs use a local volume by default
titulo_pt_br: Novas instalações self-hosted usam volume local por padrão
---

New single-host installations no longer require MinIO. Web and worker share a
private persistent volume at `/data/storage` behind the same provider-neutral
contract, with atomic writes, authenticated reads, media ranges, path
containment, health checks, persistent-mount validation, consistent backups,
and non-root runtime access. Legacy Garage variables and mounted credentials
files remain supported by both runtimes.
Backup topology follows the active endpoint and container, so an obsolete MinIO
volume cannot be mistaken for a backup of external S3.
Existing non-empty S3 or Garage configuration remains on S3, while MinIO is an
explicit optional profile.

<!-- pt-BR -->

Novas instalações em um único host não exigem mais MinIO. Web e worker
compartilham um volume privado persistente em `/data/storage` pelo mesmo
contrato neutro, com escritas atômicas, leituras autenticadas, ranges de mídia,
contenção de path, health check, validação do volume persistente, backup
consistente e runtimes não-root. Variáveis Garage e arquivos de credenciais
montados continuam compatíveis nos dois runtimes.
O backup segue o endpoint e o container ativos; um volume MinIO obsoleto não
pode ser confundido com backup de um S3 externo.
Configurações S3 ou Garage existentes continuam em S3 e o MinIO se torna um
profile opcional explícito.
