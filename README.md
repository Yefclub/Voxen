# Voxen

Plataforma web self-hosted de **biblioteca multimodal** com transcrição, análise de documentos/imagens e **chat-agente** que navega o acervo. Sem embeddings — abordagem harness/Karpathy.

## O que faz

1. Cola um link ou envia um arquivo de áudio, vídeo, imagem ou documento
2. Backend extrai conteúdo, faz chunking/transcrição quando necessário e usa OpenRouter para análise
3. Salva como `.md` com metadados, timestamps quando existirem, link original e **resumo IA** em markdown
4. Chat com agente Agno que lê / busca / resume / dispara novas análises via Postgres FTS + tools

## Stack

- **Web/API**: Bun + Hono + Vite + React + Tailwind v4 + shadcn/ui (tema zinc)
- **Chat**: Python + FastAPI + tool-calling sobre OpenRouter (streaming SSE)
- **Worker**: Python + ARQ + extrator de mídia (`yt-dlp` internamente) + `ffmpeg`
- **Auth**: better-auth (email/senha) com aprovação manual do admin
- **DB**: Postgres 17 + Prisma + FTS (`tsvector` GIN, dicionário `portuguese`)
- **Fila**: Redis + ARQ
- **Storage**: MinIO/S3-compatible (`S3_*`)
- **LLM/Transcrição**: OpenRouter (chat + Whisper unificados)

## Subir em 1 minuto (dev local)

Pré-requisitos: `docker` + `docker compose`. Nada além disso.

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Abre em `http://localhost:3000`. Primeiro cadastro vira admin e cai no onboarding (cola OpenRouter API key + escolhe modelos default). Pronto.

`make dev` cria/completa `.env` se necessário, sobe Postgres, Redis, MinIO, web, chat e worker. MinIO fica em `http://localhost:9001`.

## Subir em produção

> **Recomendado: rode em home-lab** (mini-PC, NAS, Proxmox em casa). IP
> residencial evita o bloqueio do YouTube em downloads, custo mensal é
> praticamente zero e seus dados ficam fisicamente com você. VPS continua
> suportada, mas exige cuidado extra com extração de mídia — detalhes em
> [`docs/DEPLOY.md#home-lab-vs-vps`](docs/DEPLOY.md#home-lab-vs-vps).

Tem guia passo-a-passo pra cada cenário em [`docs/DEPLOY.md`](docs/DEPLOY.md):

| Cenário | Quando usar |
|---|---|
| **Home-lab (recomendado)** | Mini-PC, NAS ou Proxmox em casa, IP residencial |
| **LXC do Proxmox** | Self-hosted, container LXC (`nesting=1`) — em casa ou em servidor |
| **Servidor + nginx do host** | VPS Linux com nginx nativo + certbot (⚠ ver aviso VPS) |
| **Servidor + nginx em container** | Tudo em Docker, profile `nginx` (⚠ ver aviso VPS) |
| **Easypanel** | Plataforma cuida de HTTPS/domínio sozinha |

Para Easypanel em produção, prefira Source **Docker image** com
`ghcr.io/yefclub/voxen:dev` ou `ghcr.io/yefclub/voxen:latest`. O modo
GitHub/Dockerfile também funciona, mas o Easypanel expõe Environment no
build-time; isso pode mostrar secrets como build args no log de build.

TL;DR home-lab (Debian/Ubuntu com Docker):

```bash
git clone https://github.com/Yefclub/Voxen.git ~/voxen
cd ~/voxen
cp .env.example .env  # edite secrets + APP_BASE_URL
mv docker-compose.override.yml docker-compose.override.dev.yml
docker compose up -d --build

# Acesso externo: Cloudflare Tunnel é o caminho mais simples em home-lab.
# Veja docs/DEPLOY.md#home-lab pra detalhes (DDNS, port forwarding, Let's Encrypt).
```

## Operação — reset de senha

Voxen **não tem SMTP nem reset por email** (decisão deliberada — self-hosted single-tenant não compensa SMTP). Quando um user esquece a senha, o owner do deploy roda no servidor:

```bash
# Via Make (recomendado — passa PASSWORD via env var, não vaza no `ps`)
make reset-password EMAIL=user@exemplo.com PASSWORD='novaSenhaForte12chars'

# Direto via env var
docker compose exec -e VOXEN_NEW_PASSWORD='novaSenhaForte12chars' web \
  bun apps/web/src/scripts/reset-password.ts user@exemplo.com

# Direto via arg (senha aparece em `ps` e shell history — pra debug rápido)
docker compose exec web bun apps/web/src/scripts/reset-password.ts \
  user@exemplo.com 'novaSenhaForte12chars'
```

O script:
1. Localiza o user pelo email
2. Gera hash da nova senha (mesmo algoritmo do `/sign-up` — better-auth scrypt)
3. Atualiza `Account.password`
4. **Revoga todas as sessões ativas** (forçando re-login)

Mínimo 12 caracteres. Mais detalhes em [`docs/DEPLOY.md`](docs/DEPLOY.md#reset-de-senha).

## Operação — atualizar sem perder dados

Comandos seguros que preservam volumes (postgres, redis, minio):

```bash
make update          # rolling restart com rebuild (zero downtime perceptível)
make build           # rebuild de imagens (sem reiniciar)
make restart         # down + up (curta indisponibilidade, dados preservados)
make backup          # snapshot postgres + MASTER_KEY + minio em ./backups/
```

**NUNCA** use `make clean` em produção — ele remove TODOS os volumes e perde os dados. O target já pede confirmação interativa.

Migrations rodam automaticamente no entrypoint do `web` (Prisma `migrate deploy`).

## Documentação

| Doc | Tema |
|---|---|
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Rodar local, testes, TDD/SDD |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | **Deploy em home-lab / VPS / Proxmox / Easypanel + nginx + HTTPS** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diagrama, fluxos, decisões de design |
| [`docs/STACK.md`](docs/STACK.md) | Versões fixadas e justificativa |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADRs |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model |
| [`docs/TRANSCRIPT-FORMAT.md`](docs/TRANSCRIPT-FORMAT.md) | Schema do `.md` |

## Workflow

Branch default: `dev`. Toda mudança via PR pra `dev`. Release: PR `dev → main` com label `release:patch|minor|major`. Detalhes em `CLAUDE.md` e `docs/DEVELOPMENT.md`.

## Licença

MIT — ver [`LICENSE`](LICENSE).
