# Voxen

English | [Português (Brasil)](docs/README.md)

Voxen is a self-hosted **multimodal knowledge base** with transcription,
document and image analysis, agentic search, and a knowledge graph. External
agents can access the library through **MCP**. Retrieval is evidence-first and
does not require vector embeddings.

## What it does

1. Paste a URL or upload audio, video, image, or document files.
2. Voxen extracts the content, transcribes or chunks it when necessary, and
   sends only the required analysis to the configured models.
3. It stores structured Markdown with source metadata, timestamps, canonical
   links, and an AI-generated summary.
4. It organizes the library into folders and exposes it through chat, MCP, and
   the Brain knowledge graph.

## Stack

- **Web/API:** Bun, Hono, Vite, React, Tailwind CSS v4, and shadcn/ui
- **MCP:** Streamable HTTP at `/mcp` for Claude Code, Codex, Cursor, and other
  compatible clients
- **Worker:** Python asyncio, `yt-dlp`, and `ffmpeg`
- **Authentication:** Better Auth with email/password and administrator approval
- **Database:** PostgreSQL 17, Prisma, and full-text search
- **Queue:** durable PostgreSQL jobs with leases and heartbeats; Redis is used
  for wakeups and realtime events
- **Storage:** MinIO or another S3-compatible service
- **Models:** OpenRouter, configured centrally by an administrator

## Local quick start

Requirements: Docker and Docker Compose v2.

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Open `http://localhost:3000`. The first account becomes the administrator and
enters onboarding. Add an OpenRouter key; Voxen validates it and applies the
canonical model configuration for the instance.

`make dev` creates or completes `.env` when necessary and starts PostgreSQL,
Redis, MinIO, the web app, and the worker. The MinIO console is available at
`http://localhost:9001`.

## Production deployment

Voxen is best suited to a home lab, where data stays under your control and a
residential IP is less likely to trigger media download restrictions. VPS,
Proxmox LXC, Docker Compose, nginx, and Easypanel deployments are also
supported. See the [deployment guide](docs/en/DEPLOY.md) for the complete
instructions.

For Easypanel, prefer the published images:

```text
ghcr.io/yefclub/voxen-web:latest
ghcr.io/yefclub/voxen-worker:latest
```

A minimal Docker Compose deployment starts with:

```bash
git clone https://github.com/Yefclub/Voxen.git ~/voxen
cd ~/voxen
cp .env.example .env
# Edit secrets and APP_BASE_URL before continuing.
mv docker-compose.override.yml docker-compose.override.dev.yml
docker compose up -d --build
```

Migrations are applied automatically by the web container through
`prisma migrate deploy`.

## Operations

Safe update commands preserve the PostgreSQL, Redis, and MinIO volumes:

```bash
make update
make build
make restart
make backup
```

Do not run `make clean` in production: that target removes all volumes after an
interactive confirmation.

Voxen intentionally does not require SMTP for password recovery. An instance
owner can reset a password from the server and revoke existing sessions:

```bash
make reset-password EMAIL=user@example.com PASSWORD='a-new-strong-password'
```

## Documentation

The [documentation index](docs/README.md) links the English and Portuguese
documentation tracks.

| Document                                          | Topic                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| [Development](docs/en/DEVELOPMENT.md)             | Local environment, tests, SDD/TDD, and workflow       |
| [Deployment](docs/en/DEPLOY.md)                   | Home lab, VPS, Proxmox, nginx, Compose, and Easypanel |
| [Architecture](docs/en/ARCHITECTURE.md)           | Components, flows, and architectural decisions        |
| [Stack](docs/en/STACK.md)                         | Runtime and dependency choices                        |
| [Decisions](docs/en/DECISIONS.md)                 | Architecture Decision Records                         |
| [Security](docs/en/SECURITY.md)                   | Threat model and technical controls                   |
| [Transcript format](docs/en/TRANSCRIPT-FORMAT.md) | Canonical Markdown schema                             |
| [Contributing](CONTRIBUTING.md)                   | Contribution requirements                             |
| [Security policy](SECURITY.md)                    | Private vulnerability reporting                       |
| [Support](SUPPORT.md)                             | Where to ask for help                                 |
| [Changelog](CHANGELOG.md)                         | Release and development history                       |

## Branch and release workflow

`main` is the stable default branch and `dev` is the protected integration
branch. Feature and maintenance pull requests target `dev`. Stable releases are
prepared from `dev`, reviewed through a pull request to `main`, and published as
SemVer tags.

## License

MIT — see [LICENSE](LICENSE).
