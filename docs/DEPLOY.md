# Deploy — Voxen

Voxen é projetado pra rodar self-hosted via **Easypanel** (ou qualquer host com Docker + Docker Compose). O `docker-compose.yml` da raiz é o mesmo usado em dev — princípio de paridade dev/prod.

## Pré-requisitos no host

- Docker 24+ e Docker Compose v2
- Easypanel (recomendado pra facilitar HTTPS, domínio, backups) OU qualquer Linux com Docker
- Volume persistente pros dados (Postgres, Redis, Garage, master key)
- Conta GitHub com acesso ao repo `YefClub-Org/Voxen` (privado) — pra deploy via git pull, configurar deploy key

## Deploy via Easypanel

### 1. Configurar projeto

No Easypanel:
1. Criar projeto "Voxen"
2. Tipo: **Compose**
3. Source: GitHub → `YefClub-Org/Voxen` → branch `main`
4. Compose file: `docker-compose.yml` (deixar `docker-compose.override.yml` de fora — override é só dev)
5. Build context: raiz do repo

### 2. Variáveis de ambiente

Easypanel UI → Environment. Preencher (NÃO usar defaults do `.env.example` em prod):

```env
APP_BASE_URL=https://voxen.seudominio.com
NODE_ENV=production

POSTGRES_DB=voxen
POSTGRES_USER=voxen
POSTGRES_PASSWORD=<gerar com openssl rand -base64 32>

REDIS_PASSWORD=<gerar com openssl rand -base64 32>

GARAGE_RPC_SECRET=<gerar com openssl rand -hex 32>   # 64 hex chars obrigatório
GARAGE_ADMIN_TOKEN=<gerar com openssl rand -base64 32>
GARAGE_BUCKET=voxen-transcripts

BETTER_AUTH_SECRET=<gerar com openssl rand -base64 32>
```

**Master key**: NÃO vai no env. É gerada automaticamente em `/data/master.key` (volume Docker) no primeiro boot. Backup desse volume é crítico.

### 3. Volumes persistentes

Easypanel mostra os volumes definidos no compose. Garantir que todos têm storage persistente atribuído:
- `pgdata` (~10GB inicial, cresce com transcrições)
- `redisdata` (1GB ok)
- `garage_meta` (1GB)
- `garage_data` (cresce com `.md` — estimar 10MB por transcrição)
- `garage_creds` (KB)
- `master_key` (KB — **CRÍTICO PRA RECOVERY**)

### 4. Domínio + HTTPS

Easypanel:
- Service `web` porta 3000 → expor via Traefik
- Domínio `voxen.seudominio.com`
- HTTPS automático via Let's Encrypt

### 5. Deploy

Easypanel:
- Click "Deploy"
- Acompanha logs do build
- Após containers `healthy` → acessar URL
- Primeiro cadastro vira admin → tela de setup

## Operação

### Backups

**Postgres**:
```bash
# Cron no host (ex: 03:00 diário)
docker compose exec -T postgres pg_dump -U voxen voxen | gzip > /backups/voxen-$(date +%F).sql.gz
# Retention: rotacionar 30 dias
find /backups -name 'voxen-*.sql.gz' -mtime +30 -delete
```

**Garage** (`.md` transcripts):
- Réplica dos arquivos do volume `garage_data` (rsync/restic pra outro disco/cloud)
- Garage tem replica nativa se rodar múltiplos nós — fora do escopo do single-node setup

**Master key** (`/data/master.key`):
- Backup criptografado em local seguro (NÃO no mesmo host)
- Sem essa key, os secrets em DB ficam inacessíveis

### Logs

Easypanel agrega logs por container. Para análise mais profunda:
- Considerar Loki + Grafana (fora do escopo MVP)
- Logs estruturados (JSON) facilitam parsing futuro

### Monitoring

MVP: 
- Healthcheck `/health` no `web` e `chat`
- Easypanel mostra status dos containers
- Métricas básicas via `docker stats`

Futuro:
- Prometheus + Grafana
- Alertas via webhook quando container reinicia ou healthcheck falha

### Upgrade

```bash
# No host
cd /caminho/do/repo/Voxen
git checkout main && git pull
docker compose pull   # se imagens são pré-built
docker compose up -d --build
# Migrations Prisma rodam automaticamente no entrypoint do web
```

Pra rollback:
```bash
git checkout v0.X.Y   # tag anterior
docker compose up -d --build
# Rollback de schema é manual — ter cuidado com migrations destrutivas
```

### Rotação de secrets

1. Gerar novos valores
2. Atualizar Easypanel env
3. `docker compose up -d` (recria containers afetados)
4. Postgres password: precisa de ALTER USER no DB primeiro (`docker compose exec postgres psql -U voxen -c "ALTER USER voxen WITH PASSWORD '...'"`)
5. **Master key rotation**: não suportado no MVP — vai exigir re-encrypt de todos os secrets em DB (futuro)

### Scaling

Single-node por design. Pra escalar:
- Web: replicar (load balancer na frente) — sessões em DB facilita
- Chat: replicar (cada instância stateless, sessão Agno por request)
- Worker: replicar (ARQ distribui jobs)
- Postgres: master-replica (fora do escopo MVP)
- Garage: ativar replication_factor>1 e múltiplos nós

## Variáveis de ambiente — referência completa

| Var | Onde | Quem usa | Default dev |
|---|---|---|---|
| `APP_BASE_URL` | `.env` | web (CORS, links) | `http://localhost:3000` |
| `NODE_ENV` | `.env` | web | `development` |
| `POSTGRES_DB` | `.env` | postgres + web/chat/worker | `voxen` |
| `POSTGRES_USER` | `.env` | postgres + apps | `voxen` |
| `POSTGRES_PASSWORD` | `.env` | postgres + apps | `dev_change_me_in_prod` |
| `REDIS_PASSWORD` | `.env` | redis + apps | `dev_change_me_in_prod` |
| `GARAGE_RPC_SECRET` | `.env` | garage | placeholder (precisa 64 hex em prod) |
| `GARAGE_ADMIN_TOKEN` | `.env` | garage | placeholder |
| `GARAGE_BUCKET` | `.env` | garage-init + apps | `voxen-transcripts` |
| `BETTER_AUTH_SECRET` | `.env` | web (assinatura de cookies) | placeholder |
| `DATABASE_URL` | derivado no compose | apps | postgresql://voxen:.../voxen |
| `REDIS_URL` | derivado no compose | apps | redis://:.../0 |
| `MASTER_KEY_PATH` | hardcoded compose | apps | `/data/master.key` |
| `GARAGE_ENDPOINT` | hardcoded compose | apps | `http://garage:3900` |
| `CHAT_SERVICE_URL` | hardcoded compose | web | `http://chat:8001` |
| `GARAGE_CREDS_PATH` | hardcoded compose | apps | `/creds/voxen.env` |

Tudo que **NÃO** está acima é **runtime config** e vive cifrado em `settings` (DB), configurado pelo admin na UI:
- `openrouter_api_key`
- `default_chat_model`
- `default_transcription_model`
- `smtp_*` (opcional, fase 2)

## Checklist de produção

- [ ] `.env` em prod com todos os secrets ROTACIONADOS (não os defaults de dev)
- [ ] HTTPS configurado no Easypanel (Let's Encrypt ativo)
- [ ] Backup cron do Postgres ativo
- [ ] Backup do volume `master_key` em local seguro fora do host
- [ ] DNS apontado e propagado
- [ ] Primeiro cadastro feito (cria admin)
- [ ] Setup inicial concluído (OpenRouter key cadastrada)
- [ ] Branch protection ativa em `main` e `dev` (no GitHub)
- [ ] Dependabot ativo
- [ ] CI verde em `dev` e `main`
