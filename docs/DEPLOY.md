# Deploy — Voxen

Guia prático pra colocar Voxen rodando em produção. Os arquivos do dev são os mesmos do prod — princípio de paridade.

Escolha o seu cenário:

| Cenário | Quando usar | Seção |
|---|---|---|
| **Servidor próprio + nginx do host** | VPS, dedicated, máquina local. Você já tem (ou quer) nginx instalado. | [Servidor + nginx host](#servidor--nginx-do-host) |
| **Servidor próprio + nginx em container** | Mesmo cenário, mas prefere tudo dockerizado. | [Servidor + nginx container](#servidor--nginx-em-container) |
| **LXC do Proxmox** | Container LXC do Proxmox. Self-hosted, energia eficiente. | [Proxmox CT](#proxmox-ct) |
| **Easypanel** | Plataforma já cuida de HTTPS e domínio. | [Easypanel App](#easypanel-app) |

> **Antes de qualquer cenário** — leia [Pré-requisitos comuns](#pré-requisitos-comuns).

---

## Pré-requisitos comuns

### 1. Domínio com DNS apontado

Crie um A/AAAA record no seu provedor de DNS:

```
voxen.seudominio.com    A    <IP do servidor>
```

Aguarde a propagação (`dig voxen.seudominio.com` deve retornar o IP).

### 2. Host com Docker

- Ubuntu 22.04+ / Debian 12+ / qualquer Linux com kernel 5.x+
- Docker Engine **24+** e Docker Compose **v2**
- 2 GB RAM mínimo, 4 GB recomendado (worker + ffmpeg + chat agent)
- 20 GB de disco (DB + Garage + imagens)
- Portas 80 e 443 livres (se for usar HTTPS direto)

Instalar Docker no Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# logout/login pra ativar o grupo
```

### 3. Variáveis de ambiente

Copie `.env.example` → `.env` e ajuste **antes do primeiro boot**:

```env
# Domínio com https
APP_BASE_URL=https://voxen.seudominio.com
NODE_ENV=production

# Trocar TODOS os secrets abaixo. Sugestão: openssl rand -base64 32
POSTGRES_PASSWORD=...
REDIS_PASSWORD=...
GARAGE_RPC_SECRET=...     # 64 hex chars — openssl rand -hex 32
GARAGE_ADMIN_TOKEN=...
BETTER_AUTH_SECRET=...    # min 32 chars
```

> No Compose, a `master.key` (AES-256-GCM) é **gerada automaticamente** no primeiro boot dentro de `/data/master.key` (volume Docker). No Easypanel App, use `MASTER_KEY` no Environment.

---

## Servidor + nginx do host

Cenário mais simples se você tem um VPS Linux com nginx instalado nativamente.

### 1. Clone e suba

```bash
git clone https://github.com/Yefclub/Voxen.git /opt/voxen
cd /opt/voxen
cp .env.example .env
# edite o .env conforme acima

# IMPORTANTE: em prod, não use o override de dev. Renomeie ou delete:
mv docker-compose.override.yml docker-compose.override.dev.yml

docker compose up -d --build
```

Aguarde os healthchecks ficarem verdes:

```bash
docker compose ps
# todos devem aparecer (healthy)
```

Smoke test direto na 3000 (interna):

```bash
curl http://localhost:3000/health
# {"ok":true,"service":"web"}
```

### 2. Configurar nginx + HTTPS

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp /opt/voxen/deploy/nginx/voxen.conf.example /etc/nginx/sites-available/voxen.conf
sudo nano /etc/nginx/sites-available/voxen.conf
# altere server_name → voxen.seudominio.com

sudo ln -s /etc/nginx/sites-available/voxen.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Certificado Let's Encrypt
sudo certbot --nginx -d voxen.seudominio.com
# certbot vai editar o arquivo automaticamente preenchendo os blocos ssl_*
```

Renovação automática já vem configurada (`certbot.timer`). Verifique com:

```bash
sudo systemctl list-timers | grep certbot
```

### 3. Verificar

Acesse `https://voxen.seudominio.com`. O primeiro cadastro vira admin e cai no onboarding.

---

## Servidor + nginx em container

Mesma ideia, mas o nginx roda dentro do Docker. Útil se você quer só `docker compose up` e pronto.

### 1. Clone e prepare certificados

```bash
git clone https://github.com/Yefclub/Voxen.git /opt/voxen
cd /opt/voxen
cp .env.example .env  # edite
mv docker-compose.override.yml docker-compose.override.dev.yml

# Gerar certificados Let's Encrypt (modo standalone, antes do nginx subir)
sudo systemctl stop nginx 2>/dev/null || true

mkdir -p deploy/nginx/certs deploy/nginx/certbot-www
sudo docker run --rm \
  -v $PWD/deploy/nginx/certs:/etc/letsencrypt \
  -v $PWD/deploy/nginx/certbot-www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly --standalone \
    -d voxen.seudominio.com \
    --email seu@email.com --agree-tos --no-eff-email

# Linka como "voxen" pra config genérica funcionar
sudo ln -s /etc/letsencrypt/live/voxen.seudominio.com \
           deploy/nginx/certs/live/voxen
```

### 2. Suba com profile `nginx`

```bash
docker compose --profile nginx up -d --build
```

Voxen vai estar em `https://voxen.seudominio.com`.

### 3. Renovação dos certificados

Adicione um cron (executa 2× ao dia, renova se faltar < 30 dias):

```bash
sudo crontab -e
# adicione:
0 3,15 * * * cd /opt/voxen && docker run --rm \
  -v $PWD/deploy/nginx/certs:/etc/letsencrypt \
  -v $PWD/deploy/nginx/certbot-www:/var/www/certbot \
  certbot/certbot renew --quiet && \
  docker compose --profile nginx exec nginx nginx -s reload
```

---

## Proxmox CT

Voxen roda perfeitamente em um LXC do Proxmox (Debian/Ubuntu unprivileged). Recursos sugeridos:

- **CPU:** 2 cores
- **RAM:** 4 GB
- **Disco:** 20 GB
- **Template:** `debian-12-standard` ou `ubuntu-24.04-standard`
- **Features:** **nesting=1** (necessário pro Docker funcionar dentro do LXC)

### 1. Criar o container

No Proxmox web UI ou via CLI:

```bash
pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname voxen \
  --cores 2 \
  --memory 4096 \
  --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 \
  --unprivileged 1 \
  --start 1
```

### 2. Entrar e instalar Docker

```bash
pct enter 200

apt update && apt -y upgrade
apt -y install curl git nginx certbot python3-certbot-nginx

curl -fsSL https://get.docker.com | sh
```

### 3. Deploy

```bash
git clone https://github.com/Yefclub/Voxen.git /opt/voxen
cd /opt/voxen
cp .env.example .env  # edite com APP_BASE_URL=https://voxen.seudominio.com e secrets
mv docker-compose.override.yml docker-compose.override.dev.yml

docker compose up -d --build
```

### 4. Reverse proxy + HTTPS

Siga os passos da seção [Servidor + nginx do host](#servidor--nginx-do-host) a partir do item 2.

### Troubleshooting LXC

- **Docker não inicia**: confira `nesting=1` nas features do CT. Se for unprivileged, talvez precise habilitar `keyctl=1` também.
- **ffmpeg lento**: aumente CPU/RAM do CT. Worker faz chunking + transcrição em paralelo, gosta de cores.
- **Garage não persiste**: cheque se o volume `garage_data` está no rootfs do CT (não em mountpoint NFS lento).

---

## Easypanel App

Easypanel cuida automaticamente de HTTPS, domínio, backups e renovação. Para
Easypanel, o caminho recomendado é **App via Dockerfile** com Postgres, Redis e
MinIO como serviços separados do próprio painel.

### 1. Provisionar dependências

No mesmo projeto do Easypanel, crie:

- **Postgres**
- **Redis**
- **MinIO**

No MinIO, crie o bucket `voxen-transcripts` e uma access key com permissão de
leitura/escrita nesse bucket.

### 2. Configurar App

1. **Criar serviço:** tipo **App**
2. **Source:** GitHub → `Yefclub/Voxen`
3. **Branch:** `dev` (ou `main` para release estável)
4. **Build path:** `/`
5. **Dockerfile:** `Dockerfile`
6. **Porta:** `3000`

### 3. Variáveis de ambiente

Easypanel UI → Voxen App → Environment. **NÃO usar defaults de dev**:

```env
APP_BASE_URL=https://voxen.seudominio.com
NODE_ENV=production
BETTER_AUTH_SECRET=<openssl rand -base64 32>
MASTER_KEY=<openssl rand -base64 32>

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB
REDIS_URL=redis://:PASSWORD@HOST:6379/0

S3_ENDPOINT=http://<projeto>_minio:9000
S3_ACCESS_KEY=<access key do MinIO>
S3_SECRET_KEY=<secret key do MinIO>
S3_BUCKET=voxen-transcripts
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

`MASTER_KEY` é a chave AES-256-GCM que cifra secrets salvos no banco. **Faça
backup desse valor** junto com o Postgres; sem ele, API keys e settings cifrados
ficam ilegíveis.

### 4. Domínio

Easypanel UI → Domains. Adicione `voxen.seudominio.com` apontando para a porta
`3000` do App. HTTPS automático via Let's Encrypt.

### 5. Deploy

Easypanel UI → Deploy. Acompanhe os logs.

No startup, a imagem roda `prisma generate`, `prisma migrate deploy` e sobe
`chat`, `worker` e `web` no mesmo container.

### 6. Backups

Configure backups de:
- Postgres
- MinIO bucket `voxen-transcripts`
- Valor do env `MASTER_KEY`

---

## Easypanel Compose + MinIO externo

Este modo é mantido como alternativa para quem quer rodar o `docker-compose.yml`
completo. Para novos deploys no Easypanel, prefira a seção **Easypanel App**.

### Passo a passo

**1. Provisionar MinIO no Easypanel**

- Easypanel UI → New service → **MinIO** (template oficial)
- Anote:
  - `MINIO_ROOT_USER` (ex: `admin`)
  - `MINIO_ROOT_PASSWORD` (gere com `openssl rand -base64 32`)
  - Endpoint interno: `http://<projeto>_minio:9000` (URL interna do Easypanel)
  - Console (UI MinIO): porta 9001, opcional pro admin debugar

**2. Criar bucket e access key**

- Abra a console MinIO (porta 9001, pode expor temporariamente)
- Login com `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
- **Buckets → Create Bucket**: `voxen-transcripts`
- **Access Keys → Create**:
  - Salve `Access Key` e `Secret Key` — vão pro `.env` do Voxen
  - Policy: default (full access ao bucket é suficiente)

**3. Configurar Voxen pra usar o MinIO**

Easypanel UI → Voxen → Environment. Adicione:

```env
# Storage S3 externo (precedência sobre GARAGE_*)
S3_ENDPOINT=http://<projeto>_minio:9000
S3_ACCESS_KEY=<da etapa 2>
S3_SECRET_KEY=<da etapa 2>
S3_BUCKET=voxen-transcripts
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true   # MinIO precisa
```

**4. Remover o serviço Garage do compose (opcional)**

Como você está usando MinIO, pode remover o serviço `garage` do `docker-compose.yml` pra economizar recursos. Edite no fork:

```yaml
# REMOVER as seções:
# - garage:
# - garage-init:
# E nos depends_on de web/worker/chat, tire `garage-init`
```

Ou mantenha — o Voxen prefere `S3_*` quando presente e ignora `garage`, então não há conflito (só fica idle).

**5. Validar**

Após deploy, valide:

```bash
# Healthcheck profundo confere conectividade S3
curl https://voxen.seudominio.com/health/deep | jq

# Deve retornar:
# { "checks": { "postgres": true, "redis": true, "chat": true, "s3": true } }
```

Se `s3: false`, verifique logs do worker — geralmente é credencial errada ou bucket inexistente.

### Troubleshooting S3

| Sintoma | Causa provável | Fix |
|---------|----------------|-----|
| `SignatureDoesNotMatch` | Secret errado ou clock skew | Recopie a secret; sincronize NTP |
| `NoSuchBucket` | Bucket não criado | Crie na console MinIO |
| `403 Forbidden` | Access key sem policy | Default policy ou attach `readwrite` |
| `Connection refused` | Endpoint errado | Use URL interna do Easypanel (não localhost) |
| `MalformedXML` | Falta `S3_FORCE_PATH_STYLE=true` | Sempre `true` pra MinIO |

### Migrar do Garage embarcado pra MinIO

Se você já tem dados no Garage e quer migrar:

```bash
# 1. Liste objetos no Garage
aws --endpoint-url=http://localhost:3900 s3 ls s3://voxen-transcripts/ --recursive

# 2. Sync pra MinIO usando rclone (ou mc):
rclone sync garage:voxen-transcripts minio:voxen-transcripts --progress

# 3. Troque as envs S3_* no Easypanel e redeploy
# 4. Confira `health/deep` antes de remover o Garage
```

### Variantes

Se preferir hospedar MinIO fora do Easypanel ou usar AWS S3 real, o setup é idêntico — só troca o endpoint:

```env
# AWS S3 real
S3_ENDPOINT=https://s3.amazonaws.com   # ou region-specific
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=false   # AWS NÃO precisa path-style
```

Veja [`.env.example`](../.env.example) seção S3 pra todas as variáveis suportadas.

---

## Atualização

```bash
cd /opt/voxen
git pull origin main
docker compose pull
docker compose up -d --build

# Verificar migrations aplicadas
docker compose logs web | grep -i migration
```

A imagem `web` roda `prisma migrate deploy` no entrypoint — migrations são aplicadas automaticamente no boot.

---

## Backups

Backup dos volumes Docker. Script de exemplo:

```bash
#!/bin/bash
BACKUP_DIR=/var/backups/voxen
DATE=$(date +%Y-%m-%d_%H%M)
mkdir -p $BACKUP_DIR

# Postgres
docker compose exec -T postgres pg_dump -U voxen voxen | gzip > $BACKUP_DIR/db-$DATE.sql.gz

# Master key (NUNCA perca isso)
# Easypanel App: salve o valor do env MASTER_KEY em cofre de senhas.
# Compose legado: faça backup do volume voxen_master_key.
docker run --rm -v voxen_master_key:/data alpine tar czf - -C /data . > $BACKUP_DIR/master-key-$DATE.tar.gz

# Garage (transcrições .md)
docker run --rm -v voxen_garage_data:/data alpine tar czf - -C /data . > $BACKUP_DIR/garage-$DATE.tar.gz
```

Rode via cron diário. **A master key é o mais crítico** — sem ela, os secrets cifrados (OpenRouter key, modelos default) viram lixo.

---

## Monitoramento

Endpoints de health:

| Endpoint | Service | Propósito | Resposta |
|---|---|---|---|
| `GET /health` | web (3000) | **Liveness** — proxy/reverse-proxy. Sempre 200 se processo vivo | `{"ok":true,"service":"web"}` |
| `GET /health/deep` | web (3000) | **Readiness** — checa DB + Redis + chat service + S3/Garage | 200 com checks ou 503 se algum falhar |
| `GET /health` | chat (8001, interno) | Liveness do FastAPI | `{"ok":true,"service":"chat"}` |
| `GET /health/deep` | chat (8001, interno) | Checa DB + master key carregável | 200/503 com latências |

Exemplo de resposta do `/health/deep` (web):
```json
{
  "ok": true,
  "checks": {
    "postgres": { "ok": true, "latencyMs": 4 },
    "redis":    { "ok": true, "latencyMs": 1 },
    "chat":     { "ok": true, "latencyMs": 12 },
    "s3":       { "ok": true, "latencyMs": 8 }
  }
}
```

Quando algum check falhar, o endpoint retorna **HTTP 503** com `ok: false`
e o erro no check correspondente — perfeito pra alerta automático.

**Uptime Kuma / Healthchecks.io:**
- Liveness simples → `https://voxen.seudominio.com/health`
- Status real → `https://voxen.seudominio.com/health/deep` com check de HTTP 200

Outras ferramentas:
- `docker compose ps` — status dos containers
- `docker compose logs -f web chat worker` — logs ao vivo

---

## Reset de senha

Voxen **não tem SMTP nem reset por email** — decisão de design pra evitar complexidade desnecessária em deploys self-hosted single-tenant. Quando um user esquece a senha, você (owner do deploy) reseta via SSH no servidor.

### Comando

Recomendado (passa senha via env var, não vaza no `ps`/shell history):

```bash
cd /opt/voxen
make reset-password EMAIL=user@exemplo.com PASSWORD='novaSenhaForte12chars'
```

Alternativa direta:

```bash
# Via env var (seguro)
docker compose exec -e VOXEN_NEW_PASSWORD='novaSenhaForte12chars' web \
  bun apps/web/src/scripts/reset-password.ts user@exemplo.com

# Via arg (senha exposta em ps/.bash_history — só pra debug rápido)
docker compose exec web bun apps/web/src/scripts/reset-password.ts \
  user@exemplo.com 'novaSenhaForte12chars'
```

### O que o script faz

1. Localiza o `User` pelo email (case-insensitive)
2. Localiza a `Account` com `providerId='credential'` (email/senha)
3. Gera hash da senha com **scrypt** (mesmo algoritmo do `/sign-up` — better-auth)
4. Atualiza `Account.password`
5. **Revoga TODAS as sessões ativas** do user (segurança — qualquer sessão aberta cai)

### Regras

- Senha mínima: **12 caracteres** (mesmo limite do `/conta` UI)
- Email é normalizado pra lowercase
- Sem confirmação interativa (intencional — owner sabe o que tá fazendo via SSH)
- Sem rate limit (intencional — script local, owner controla quem roda)

### Quando falha

| Erro | Causa | Fix |
|---|---|---|
| `nenhum user com email "X"` | email errado ou user nunca cadastrou | Listar users: `docker compose exec postgres psql -U voxen voxen -c 'SELECT email FROM "User";'` |
| `user não tem credential account` | user só tem login social/OAuth (futuro) | OAuth login não tem senha pra resetar |
| `senha mínima de 12 caracteres` | senha curta | Use 12+ chars |

### Por que não via UI/email?

Self-hosted single-tenant não justifica overhead de fluxo email→link→form. Owner tem SSH no servidor. Reset via email implicaria SMTP configurado, domínio com SPF/DKIM, deliverability — tudo isso pra resolver algo que `make reset-password` resolve em 1 comando.

---

## Troubleshooting

| Sintoma | Causa | Fix |
|---|---|---|
| `EADDRINUSE :3000` | Porta já ocupada | Mude a porta exposta no compose ou pare o processo conflitante |
| 502 do nginx | Web container ainda iniciando | `docker compose logs web` — esperar healthcheck passar |
| Chat retorna 412 "Setup incompleto" | Admin não fez onboarding | Login como admin → `/onboarding` → cola OpenRouter key |
| Job fica eternamente RUNNING | Worker travou | `docker compose restart worker`. Job vira FAILED após uns minutos via reconciliation |
| SSE corta a cada 60s | nginx com `proxy_buffering on` | Garanta `proxy_buffering off` no location (já vem no `voxen.conf.example`) |
| `MASTER_KEY não definido` | Easypanel App sem master key | Gere com `openssl rand -base64 32` e salve no Environment |
| `master.key not found` | Compose com volume novo sem init container | `docker compose up -d master-key-init` |

Pra debug profundo, leia [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) e [`docs/SECURITY.md`](SECURITY.md).
