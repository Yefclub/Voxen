# Deploy — Voxen

Guia prático pra colocar Voxen rodando em produção. Os arquivos do dev são os mesmos do prod — princípio de paridade.

> **Recomendação geral: rode Voxen em home-lab** (mini-PC, NAS, Proxmox em
> casa). O IP residencial evita o soft-block do YouTube em downloads, o custo
> mensal é praticamente zero, e seus dados ficam fisicamente com você. VPS
> continua suportada, mas exige cuidado extra com bloqueio de mídia — veja
> [Home-lab vs VPS](#home-lab-vs-vps).

Escolha o seu cenário:

| Cenário                                   | Quando usar                                                                                    | Seção                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Home-lab (recomendado)**                | Mini-PC, NAS ou Proxmox em casa. IP residencial, sem bloqueio do YouTube.                      | [Home-lab](#home-lab)                                       |
| **Servidor próprio + nginx do host**      | VPS, dedicated, máquina local. Você já tem (ou quer) nginx instalado. ⚠ Veja aviso sobre VPS.  | [Servidor + nginx host](#servidor--nginx-do-host)           |
| **Servidor próprio + nginx em container** | Mesmo cenário, mas prefere tudo dockerizado. ⚠ Veja aviso sobre VPS.                           | [Servidor + nginx container](#servidor--nginx-em-container) |
| **LXC do Proxmox**                        | Container LXC do Proxmox (em casa ou no homelab).                                              | [Proxmox CT](#proxmox-ct)                                   |
| **Easypanel**                             | Plataforma já cuida de HTTPS e domínio. Pode rodar em VPS (com avisos) ou em servidor próprio. | [Easypanel App](#easypanel-app)                             |

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
- 20 GB de disco (DB + MinIO + imagens)
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
BETTER_AUTH_SECRET=...    # min 32 chars
MASTER_KEY=...            # openssl rand -base64 32

# MinIO/S3 local do compose
MINIO_ROOT_USER=voxen
MINIO_ROOT_PASSWORD=...
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=voxen
S3_SECRET_KEY=<mesmo valor de MINIO_ROOT_PASSWORD, ou access key dedicada>
S3_BUCKET=voxen-transcripts
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

> `MASTER_KEY` é a chave AES-256-GCM que cifra secrets salvos no banco. O
> formato é o mesmo em todos os modos: `openssl rand -base64 32`. Faça backup
> desse valor junto com Postgres e MinIO.

---

## Home-lab

Cenário recomendado: hardware doméstico (mini-PC, NAS, antigo desktop,
Raspberry Pi 5) com IP residencial. O YouTube não bloqueia downloads de IPs
residenciais com a mesma agressividade que aplica em datacenters, então a
extração de mídia funciona "out of the box" sem cookies, PO Tokens ou proxy.

### Hardware mínimo

- 2 cores x86_64 ou ARM64
- 4 GB RAM
- 20 GB de disco
- Conexão de internet residencial estável
- Energia 24/7 (UPS recomendado em regiões com queda frequente)

Recomendados: mini-PCs Intel N100/N305, Raspberry Pi 5 8GB, NAS Synology/QNAP
com Container Manager, ou um desktop antigo dedicado.

### 1. Sistema base + Docker

Instale Debian 12, Ubuntu 24.04 LTS ou outro Linux moderno. Em seguida:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# logout/login pra ativar o grupo
```

### 2. Deploy

```bash
git clone https://github.com/Yefclub/Voxen.git ~/voxen
cd ~/voxen
cp .env.example .env
# edite .env conforme [Pré-requisitos comuns](#pré-requisitos-comuns)
mv docker-compose.override.yml docker-compose.override.dev.yml

docker compose up -d --build
```

### 3. Acesso externo

Em home-lab, o IP público costuma ser dinâmico e a porta 80/443 pode estar
bloqueada pelo provedor. Duas estratégias funcionam bem:

- **Cloudflare Tunnel (mais simples)**: instale `cloudflared` no host,
  conecte sua conta Cloudflare e exponha `localhost:3000` em um subdomínio
  seu. Sem porta aberta no roteador, sem IP fixo.
- **DDNS + port forwarding**: configure DuckDNS, no-ip ou Cloudflare DNS API
  com IP dinâmico; abra portas 80 e 443 do roteador apontando pro host;
  siga a seção [Servidor + nginx do host](#servidor--nginx-do-host) a partir
  do item 2 para HTTPS via Let's Encrypt.

### Cuidados

- Backup regular dos volumes Docker (`pgdata`, `redisdata`, `minio_data`) e
  do `.env` — preferencialmente para storage externo (NAS separado, S3 ou
  drive externo).
- Se o ISP bloquear porta 80 (caso comum no Brasil), opte por Cloudflare
  Tunnel — não há como contornar o bloqueio com DDNS sozinho.
- Energia: nobreak/UPS para evitar corrupção de Postgres durante queda.

---

## Servidor + nginx do host

> ⚠ **Aviso para VPS/cloud**: o YouTube aplica soft-block agressivo em IPs de
> datacenter desde 2025. Você provavelmente vai precisar configurar um proxy
> residencial nas configurações da instância (Setup → Extração de mídia) ou
> orientar usuários a usarem o upload manual quando o download for bloqueado.
> Detalhes em [Home-lab vs VPS](#home-lab-vs-vps).

Cenário comum em VPS Linux com nginx instalado nativamente, ou em servidor
físico próprio.

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
- **MinIO não persiste**: cheque se o volume `minio_data` está no rootfs do CT (não em mountpoint NFS lento).

---

## Easypanel App

Easypanel cuida automaticamente de HTTPS, domínio, backups e renovação. Para
Easypanel, o caminho recomendado é **App via Dockerfile** com Postgres, Redis e
MinIO como serviços separados do próprio painel. Esse é o fluxo mais parecido
com o Orbital: um App principal via `Dockerfile`, infra gerenciada separada.

### 1. Provisionar dependências

No mesmo projeto do Easypanel, crie:

- **Postgres**
- **Redis**
- **MinIO**

No MinIO:

1. Abra a console do MinIO.
2. Crie o bucket `voxen-transcripts`.
3. Crie uma access key com permissão de leitura/escrita nesse bucket.
4. Guarde `Access Key` e `Secret Key`; elas entram em `S3_ACCESS_KEY` e
   `S3_SECRET_KEY`.

### 2. Configurar App

Crie um serviço **App**. Para produção, prefira **Source → Docker image**:

```txt
Image: ghcr.io/yefclub/voxen:dev      # homologação/dev
Image: ghcr.io/yefclub/voxen:latest   # main/release estável
Port: 3000
Health check path: /health
```

O workflow `Easypanel Image` publica essa imagem automaticamente quando há push
em `dev`, `main` ou tag `vX.Y.Z`. A imagem já contém `web`, `chat` e `worker`.

Por que essa é a opção recomendada: no Source **GitHub repository**, o Easypanel
constrói a imagem no servidor e, conforme a
[documentação do App Service](https://easypanel.io/docs/services/app), as
variáveis de `Environment` ficam disponíveis em build-time e run-time. Na
prática, secrets podem aparecer como `--build-arg` nos logs de build do
Easypanel. No Source **Docker image**, o Easypanel só baixa a imagem já
construída; os secrets entram apenas como env de runtime.

Se quiser usar GitHub/Dockerfile em ambiente de teste:

1. **Source:** GitHub → `Yefclub/Voxen`
2. **Branch:** `dev` (ou `main` para release estável)
3. **Build path:** `/`
4. **Dockerfile:** `Dockerfile`
5. **Porta:** `3000`
6. **Health check path:** `/health`

Trate logs de build desse modo como sensíveis. Não cole logs públicos sem
redigir `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`, `REDIS_URL` e
`S3_*`.

### 3. Variáveis de ambiente

Easypanel UI → Voxen App → Environment. **NÃO usar defaults de dev**.
No modo Docker image, esses valores não participam do build:

```env
APP_BASE_URL=https://voxen.seudominio.com
# Opcional: se houver domínio temporário + domínio final, separe por vírgula.
BETTER_AUTH_TRUSTED_ORIGINS=
NODE_ENV=production
BETTER_AUTH_SECRET=<openssl rand -base64 32>
MASTER_KEY=<openssl rand -base64 32>

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB
REDIS_URL=redis://:PASSWORD@HOST:6379/0

S3_ENDPOINT=http://<host-interno-do-minio>:9000
S3_ACCESS_KEY=<access key do MinIO>
S3_SECRET_KEY=<secret key do MinIO>
S3_BUCKET=voxen-transcripts
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

Use o host interno que o Easypanel mostra para o serviço MinIO; no projeto
`taskivus`, por exemplo, normalmente fica parecido com
`http://taskivus-minio:9000`.

Se o MinIO/S3 estiver atrás de um domínio ou proxy, use a URL pública/proxy
com esquema e sem forçar `:9000`, por exemplo `https://s3.seudominio.com` ou
`http://s3.seudominio.com`. O startup infere a porta pela URL: `http` usa `80`,
`https` usa `443` e endpoints internos com porta explícita continuam usando a
porta informada. Esse domínio/proxy precisa aceitar a API S3 completa
(`HEAD Bucket` e `PUT Object`); se ele só servir a console ou bloquear métodos,
use o endpoint interno do MinIO no App.

`MASTER_KEY` é a chave AES-256-GCM que cifra secrets salvos no banco. **Faça
backup desse valor** junto com Postgres e MinIO; sem ele, API keys e settings
cifrados ficam ilegíveis.

`APP_BASE_URL` deve ser exatamente a origem pública usada no navegador
(`https://domínio`, sem barra final). Se o deploy aceitar mais de um domínio,
inclua os alternativos em `BETTER_AUTH_TRUSTED_ORIGINS`; caso contrário o
Better Auth rejeita signup/login com `Invalid origin`.

### 4. Domínio

Easypanel UI → Domains. Adicione `voxen.seudominio.com` apontando para a porta
`3000` do App. HTTPS automático via Let's Encrypt.

### 5. Deploy

Easypanel UI → Deploy. Acompanhe os logs.

No startup, a imagem roda `prisma generate`, `prisma migrate deploy` e sobe
`chat`, `worker` e `web` no mesmo container. Antes disso ela valida Postgres,
Redis e S3/MinIO, incluindo escrita de um objeto `.voxen/healthcheck` no bucket.

Validação pós-deploy:

```bash
curl https://voxen.seudominio.com/health
curl https://voxen.seudominio.com/health/deep
```

`/health/deep` precisa retornar `ok: true`; ele valida Postgres, Redis, chat
interno e MinIO/S3.

### 6. Backups

Configure backups de:

- Postgres
- MinIO bucket `voxen-transcripts`
- Valor do env `MASTER_KEY`

---

## Easypanel Compose (alternativo)

O Compose atual também funciona, porque já sobe Postgres, Redis, MinIO, web,
chat e worker. No Easypanel, porém, prefira **Easypanel App**: o painel gerencia
melhor porta, domínio, logs e serviços separados.

Se usar Compose mesmo assim:

1. Crie um serviço **Compose**.
2. Use o repo `Yefclub/Voxen`, branch `dev` ou `main`.
3. Use `docker-compose.yml` e não use `docker-compose.override.yml`.
4. Defina no Environment os mesmos valores de `.env.example`, principalmente
   `MASTER_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD` e
   `S3_SECRET_KEY`.

### Troubleshooting S3/MinIO

| Sintoma                                              | Causa provável                                                                              | Fix                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SignatureDoesNotMatch`                              | Secret errado ou clock skew                                                                 | Recopie a secret; sincronize NTP                                                                      |
| `NoSuchBucket`                                       | Bucket não criado                                                                           | Crie na console MinIO                                                                                 |
| `403 Forbidden`                                      | Access key sem policy                                                                       | Default policy ou attach `readwrite`                                                                  |
| `Connection refused`                                 | Endpoint errado                                                                             | No App use URL interna do Easypanel; no Compose use `http://minio:9000`                               |
| Startup preso em `S3 ainda indisponível`             | Porta do endpoint S3 errada ou domínio sem proxy para S3                                    | Para domínio/proxy use `https://s3.seudominio.com`; para MinIO interno use `http://host-interno:9000` |
| Startup falha em `S3 bucket ... sem escrita`         | Bucket não existe, endpoint não aceita API S3 ou access key sem escrita                     | Crie o bucket, revise credenciais/policy ou troque para o endpoint interno do MinIO                   |
| Upload de avatar retorna 502                         | Falha de escrita no bucket                                                                  | Use `/health/deep` e logs do App; o bucket precisa aceitar `PUT Object`                               |
| `/api/auth/*` com `Invalid origin`                   | `APP_BASE_URL` não bate com o domínio acessado                                              | Ajuste `APP_BASE_URL` ou adicione a origem em `BETTER_AUTH_TRUSTED_ORIGINS`                           |
| `/api/jobs/events/me` com `ERR_HTTP2_PROTOCOL_ERROR` | Deploy antigo emitindo headers SSE incompatíveis com HTTP/2 ou proxy fechando stream ocioso | Use versão com SSE HTTP/2-safe; ela não envia `Connection`/`Transfer-Encoding` e usa heartbeat curto  |
| `MalformedXML`                                       | Falta `S3_FORCE_PATH_STYLE=true`                                                            | Sempre `true` pra MinIO                                                                               |
| Redis avisa `Memory overcommit must be enabled`      | Kernel com `vm.overcommit_memory=0`                                                         | No host: `sudo sysctl -w vm.overcommit_memory=1` e persista em `/etc/sysctl.conf`                     |

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
grep '^MASTER_KEY=' .env > $BACKUP_DIR/master-key-$DATE.env
chmod 0600 $BACKUP_DIR/master-key-$DATE.env

# MinIO (transcrições .md e avatars)
docker run --rm -v voxen_minio_data:/data alpine tar czf - -C /data . > $BACKUP_DIR/minio-$DATE.tar.gz
```

Rode via cron diário. **A master key é o mais crítico** — sem ela, os secrets cifrados (OpenRouter key, modelos default) viram lixo.

---

## Monitoramento

Endpoints de health:

| Endpoint           | Service              | Propósito                                                       | Resposta                              |
| ------------------ | -------------------- | --------------------------------------------------------------- | ------------------------------------- |
| `GET /health`      | web (3000)           | **Liveness** — proxy/reverse-proxy. Sempre 200 se processo vivo | `{"ok":true,"service":"web"}`         |
| `GET /health/deep` | web (3000)           | **Readiness** — checa DB + Redis + chat service + S3/MinIO      | 200 com checks ou 503 se algum falhar |
| `GET /health`      | chat (8001, interno) | Liveness do FastAPI                                             | `{"ok":true,"service":"chat"}`        |
| `GET /health/deep` | chat (8001, interno) | Checa DB + master key carregável                                | 200/503 com latências                 |

Exemplo de resposta do `/health/deep` (web):

```json
{
  "ok": true,
  "checks": {
    "postgres": { "ok": true, "latencyMs": 4 },
    "redis": { "ok": true, "latencyMs": 1 },
    "chat": { "ok": true, "latencyMs": 12 },
    "s3": { "ok": true, "latencyMs": 8 }
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

| Erro                              | Causa                                   | Fix                                                                                             |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `nenhum user com email "X"`       | email errado ou user nunca cadastrou    | Listar users: `docker compose exec postgres psql -U voxen voxen -c 'SELECT email FROM "User";'` |
| `user não tem credential account` | user só tem login social/OAuth (futuro) | OAuth login não tem senha pra resetar                                                           |
| `senha mínima de 12 caracteres`   | senha curta                             | Use 12+ chars                                                                                   |

### Por que não via UI/email?

Self-hosted single-tenant não justifica overhead de fluxo email→link→form. Owner tem SSH no servidor. Reset via email implicaria SMTP configurado, domínio com SPF/DKIM, deliverability — tudo isso pra resolver algo que `make reset-password` resolve em 1 comando.

---

## Home-lab vs VPS

### Por que home-lab é a recomendação

YouTube e plataformas similares aplicam bloqueio agressivo em IPs de
datacenter (provedores como Hostinger, DigitalOcean, AWS, Hetzner etc.) desde 2025. Mesmo com cookies, PO Tokens e player clients alternativos, esses
bypasses são frágeis e podem causar banimento de contas Google usadas como
fonte de cookies.

Em home-lab, o IP é residencial, fornecido pelo seu ISP doméstico, e o
YouTube trata-o como usuário humano comum. Resultado prático: downloads
funcionam direto, sem necessidade de configurações extras de mitigação.

### O que muda na operação

| Aspecto                    | Home-lab                               | VPS                        |
| -------------------------- | -------------------------------------- | -------------------------- |
| Download direto do YouTube | Funciona                               | Frequentemente bloqueado   |
| Custo mensal               | Eletricidade (~R$5-15)                 | R$25-100+                  |
| Uptime                     | Dependente da rede/energia da casa     | Geralmente 99,9%+          |
| Soberania dos dados        | Em casa                                | Em servidor de terceiros   |
| IP fixo / portas 80-443    | Geralmente não — use Cloudflare Tunnel | Sim, padrão                |
| Hardware                   | Você compra/reaproveita                | Provisionado pelo provedor |

### Mitigações em VPS quando home-lab não é opção

1. **Upload manual**: continua funcionando 100%. Quando um link do YouTube
   for bloqueado, o usuário baixa pelo navegador (com ferramenta local de
   sua preferência) e faz upload pelo Voxen.
2. **Proxy residencial controlado**: contrate um proxy residencial pago
   (ex.: Bright Data, Oxylabs, Scrapeless) e cole a(s) URL(s) em Setup →
   Extração de mídia. O Voxen escolhe aleatoriamente uma URL por download.
   Use apenas proxies que você controla; proxies públicos gratuitos são
   instáveis e podem ser maliciosos.
3. **Transcript/legendas primeiro**: o worker tenta obter legendas do YouTube
   antes de baixar áudio. Quando há transcript acessível, a transcrição não
   consome OpenRouter e evita o download de mídia; quando não há, o fluxo cai
   nos fallbacks normais (`yt-dlp` legendas → áudio → upload manual).
4. **PO token/bgutil opt-in**: se você opera um provider HTTP bgutil próprio,
   defina `YTDLP_BGUTIL_BASE_URL=http://host:4416` no ambiente do worker. O
   Voxen então passa esse provider ao `yt-dlp` e prefere o client `mweb`. Não
   use providers públicos; isso é mitigação frágil, não garantia de download.
5. **Híbrido**: rode Voxen no VPS (uptime, HTTPS gerenciado) e direcione o
   tráfego do worker por um proxy/VPN residencial. Avançado, requer
   configuração de rede mais cuidadosa.

### Decisão arquitetural

Voxen é self-hosted single-tenant focado em construir uma base de
conhecimento pessoal/de pequenos times. O modelo casa naturalmente com
home-lab: 1-10 usuários, hardware modesto, dados em casa. VPS continua
suportada para quem precisa de uptime ou não tem hardware doméstico, com a
ressalva acima.

---

## Troubleshooting

| Sintoma                              | Causa                                 | Fix                                                                                                                                 |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE :3000`                   | Porta já ocupada                      | Mude a porta exposta no compose ou pare o processo conflitante                                                                      |
| 502 do nginx                         | Web container ainda iniciando         | `docker compose logs web` — esperar healthcheck passar                                                                              |
| Chat retorna 412 "Setup incompleto"  | Admin não fez onboarding              | Login como admin → `/onboarding` → cola OpenRouter key                                                                              |
| Job fica eternamente RUNNING         | Worker travou                         | `docker compose restart worker`. Job vira FAILED após uns minutos via reconciliation                                                |
| SSE corta a cada 60s                 | nginx com `proxy_buffering on`        | Garanta `proxy_buffering off` no location (já vem no `voxen.conf.example`)                                                          |
| `MASTER_KEY não definido`            | Environment sem master key            | Gere com `openssl rand -base64 32` e salve no `.env`/Environment                                                                    |
| `NoSuchBucket` no `/health/deep`     | Bucket MinIO não criado               | `make minio-init` ou crie `voxen-transcripts` na console                                                                            |
| "YouTube bloqueou o download" em VPS | IP de datacenter marcado pelo YouTube | Veja [Home-lab vs VPS](#home-lab-vs-vps). Opções: migrar pra home-lab, configurar proxy residencial em Setup, ou usar upload manual |

Pra debug profundo, leia [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) e [`docs/SECURITY.md`](SECURITY.md).
