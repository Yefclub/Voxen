# Voxen

Plataforma web self-hosted de **biblioteca de vídeos** com transcrição automática e **chat-agente** que navega o acervo. Sem embeddings — abordagem harness/Karpathy.

## O que faz

1. Cola um link de YouTube no painel
2. Backend baixa o vídeo, extrai áudio, faz chunking com `ffmpeg`, transcreve via OpenRouter Whisper
3. Salva como `.md` com timestamps clicáveis, thumbnail, título, link original e **resumo IA** em markdown
4. Chat com agente Agno que lê / busca / resume / dispara nova transcrição via Postgres FTS + tools

## Stack

- **Web/API**: Bun + Hono + Vite + React + Tailwind v4 + shadcn/ui (tema zinc)
- **Chat**: Python + FastAPI + tool-calling sobre OpenRouter (streaming SSE)
- **Worker**: Python + ARQ + `yt-dlp` + `ffmpeg`
- **Auth**: better-auth (email/senha) com aprovação manual do admin
- **DB**: Postgres 17 + Prisma + FTS (`tsvector` GIN, dicionário `portuguese`)
- **Fila**: Redis + ARQ
- **Storage**: Garage S3 self-hosted (ou MinIO/AWS via `S3_*`)
- **LLM/Transcrição**: OpenRouter (chat + Whisper unificados)

## Subir em 1 minuto (dev local)

Pré-requisitos: `docker` + `docker compose`. Nada além disso.

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Abre em `http://localhost:3000`. Primeiro cadastro vira admin e cai no onboarding (cola OpenRouter API key + escolhe modelos default). Pronto.

> Master key AES-256-GCM é gerada automaticamente no primeiro boot. Garage S3 faz bootstrap sozinho. Sem `.env` pra editar em dev.

## Subir em produção

Tem guia passo-a-passo pra 4 cenários em [`docs/DEPLOY.md`](docs/DEPLOY.md):

| Cenário | Quando usar |
|---|---|
| **Servidor + nginx do host** | VPS Linux com nginx nativo + certbot |
| **Servidor + nginx em container** | Tudo em Docker, profile `nginx` |
| **LXC do Proxmox** | Self-hosted, container LXC (`nesting=1`) |
| **Easypanel** | Plataforma cuida de HTTPS/domínio sozinha |

TL;DR pro cenário mais comum (VPS + nginx + Let's Encrypt):

```bash
git clone https://github.com/Yefclub/Voxen.git /opt/voxen
cd /opt/voxen
cp .env.example .env  # edite secrets + APP_BASE_URL
mv docker-compose.override.yml docker-compose.override.dev.yml
docker compose up -d --build

# nginx + HTTPS
sudo cp deploy/nginx/voxen.conf.example /etc/nginx/sites-available/voxen.conf
# ajuste server_name e:
sudo ln -s /etc/nginx/sites-available/voxen.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d voxen.seudominio.com
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

Comandos seguros que preservam volumes (postgres, garage, master_key):

```bash
make update          # rolling restart com rebuild (zero downtime perceptível)
make build           # rebuild de imagens (sem reiniciar)
make restart         # down + up (curta indisponibilidade, dados preservados)
make backup          # snapshot postgres + master_key + garage em ./backups/
```

**NUNCA** use `make clean` em produção — ele remove TODOS os volumes e perde os dados. O target já pede confirmação interativa.

Migrations rodam automaticamente no entrypoint do `web` (Prisma `migrate deploy`).

## Documentação

| Doc | Tema |
|---|---|
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Rodar local, testes, TDD/SDD |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | **Deploy em VPS / Proxmox / Easypanel + nginx + HTTPS** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diagrama, fluxos, decisões de design |
| [`docs/STACK.md`](docs/STACK.md) | Versões fixadas e justificativa |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADRs |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model |
| [`docs/TRANSCRIPT-FORMAT.md`](docs/TRANSCRIPT-FORMAT.md) | Schema do `.md` |

## Workflow

Branch default: `dev`. Toda mudança via PR pra `dev`. Release: PR `dev → main` com label `release:patch|minor|major`. Detalhes em `CLAUDE.md` e `docs/DEVELOPMENT.md`.

## Licença

MIT — ver [`LICENSE`](LICENSE).
