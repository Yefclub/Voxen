# Stack — Voxen

This file tracks the expected runtimes, major libraries, infrastructure images, CI tooling, and upgrade policy.

Update it whenever a meaningful runtime, major version, or infrastructure component changes.

## Runtimes

| Technology | Version | Purpose |
|---|---|---|
| Bun | `>=1.2` (CI `1.2.x`; Docker images `1.3`) | Web/API runtime for `apps/web` |
| Node.js | `22 LTS` | Tooling compatibility, especially Prisma and CI tasks |
| Python | `3.13` | `apps/chat` and `apps/worker` |
| pnpm | `9.x` | TypeScript workspace package manager |
| uv | latest | Python package and environment manager |

## Web App

| Library | Purpose |
|---|---|
| Hono | HTTP server and route composition |
| React + React DOM | `^19` | Front-end UI |
| Vite | `^6` | Build and dev server |
| Tailwind CSS v4 | `^4` | Styling system |
| shadcn/ui-style primitives | UI components with the zinc theme |
| Better Auth | `^1` | Email/password auth with Prisma adapter |
| Prisma | `^6` | Database access and migrations |
| Zod | `^4` | Input validation |
| ESLint + Prettier | `^9` / `^3` | Linting and formatting |
| TypeScript | `^5.6` | Static typing |
| Vitest / Bun test | `^3` | TypeScript tests |

## Python Apps

| Library | Purpose |
|---|---|
| FastAPI | Internal chat HTTP service |
| Agno | Agent framework and tool calling |
| OpenAI-compatible client | OpenRouter API access |
| httpx | Async HTTP client |
| asyncpg | Direct Postgres access for tools and workers |
| Pydantic | Schemas and validation |
| asyncio + asyncpg | Postgres-backed durable jobs with leases and heartbeats |
| yt-dlp | Media extraction engine |
| ffmpeg | Audio extraction and segmentation |
| ruff, mypy, pytest | Linting, type checking, and tests |

## Infrastructure

| Component | Image | Purpose |
|---|---|---|
| Postgres | `postgres:17-alpine` | Primary database and full-text search |
| Redis | `redis:7-alpine` | Ephemeral job wakeups, realtime events, cache, and rate limits |
| MinIO | `minio/minio` | S3-compatible object storage |

## CI and Security Tooling

| Tool | Purpose |
|---|---|
| GitHub Actions | CI runner |
| `actions/setup-node@v6` | Node.js setup |
| `oven-sh/setup-bun@v2` | Bun setup |
| `pnpm/action-setup@v6` | pnpm setup |
| `actions/setup-python@v6` | Python setup |
| `astral-sh/setup-uv@v8.1.0` | uv and Python tooling setup |
| CodeQL | JavaScript/TypeScript static analysis |
| `actions/dependency-review-action@v5` | dependency review on pull requests |
| `aquasecurity/trivy-action@v0.36.0` | filesystem and container scanning |
| pip-audit | Python dependency advisories |
| pnpm audit | TypeScript dependency advisories |
| gitleaks | Secret scanning |
| `docker/build-push-action@v7` | container builds and pushes |

## Upgrade Policy

- Patch upgrades: safe Dependabot PRs can be reviewed and merged when CI is green.
- Minor upgrades: require local validation and review.
- Major upgrades: require a migration note or ADR when behavior, APIs, or tooling contracts change.
