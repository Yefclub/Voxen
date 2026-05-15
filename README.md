# Voxen

Plataforma web self-hosted de **knowledge base** alimentada por transcrição de vídeos de YouTube, Instagram e TikTok, com **chat-agente** que navega o acervo via ferramentas (sem embeddings — abordagem harness/Karpathy).

## O que faz

1. Cola um link de YouTube/Instagram/TikTok no painel
2. Backend baixa o vídeo, extrai áudio, faz chunking com `ffmpeg`, transcreve via OpenRouter
3. Salva como `.md` com minutagem clicável (`[mm:ss](url?t=Ns)`), thumbnail, título e link original
4. Chat com agente Agno que lê/busca/navega seus `.md` via Postgres FTS

## Stack

- **Web/API**: Bun + Hono + Vite + React + Tailwind v4 + shadcn/ui (tema zinc)
- **Chat**: Python + FastAPI + Agno (streaming SSE)
- **Worker**: Python + ARQ + `yt-dlp` + `ffmpeg`
- **Auth**: better-auth (email/senha) com aprovação manual do admin
- **DB**: Postgres 17 + Prisma + FTS (`tsvector` GIN, dicionário `portuguese`)
- **Fila**: Redis + ARQ
- **Storage**: Garage S3 (self-hosted)
- **LLM/Transcrição**: OpenRouter (chat + audio + embeddings se quiser)
- **Deploy**: Easypanel (mesmo `docker-compose.yml` do dev)

## Setup

Pré-requisitos: `docker` + `docker compose`. Nada além disso.

```bash
git clone https://github.com/YefClub-Org/Voxen.git
cd Voxen
make dev
```

Sobe Postgres, Redis, Garage, web, chat e worker num único comando. Master key gerada automaticamente num volume. Sem env pra preencher.

Abra `http://localhost:3000` — primeiro cadastro vira admin e cai na tela de setup inicial onde você cola sua API key da OpenRouter e escolhe os modelos default.

## Documentação

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — diagrama e fluxos
- [`docs/STACK.md`](docs/STACK.md) — versões fixadas e por quê
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — ADRs
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — rodar local, testes, TDD/SDD
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Easypanel
- [`docs/TRANSCRIPT-FORMAT.md`](docs/TRANSCRIPT-FORMAT.md) — schema do `.md`

## Workflow

Branch default: `dev`. Toda mudança via PR pra `dev`. Release: PR `dev → main` com label `release:patch|minor|major`. Detalhes em `CLAUDE.md` e `docs/DEVELOPMENT.md`.

## Licença

MIT — ver [`LICENSE`](LICENSE).
