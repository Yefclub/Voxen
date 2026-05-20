# Stack — Voxen

Versões fixadas e justificativas. Atualizar este arquivo SEMPRE que mudar uma versão major/minor.

## Runtimes e linguagens

| Tecnologia | Versão | Por quê |
|---|---|---|
| Bun | `1.2.x` | Runtime do `apps/web`. Rápido, suporta TS nativo, ótimo dev experience |
| Node | `22 LTS` | Compatibilidade com tooling que ainda não cobre Bun (Prisma CLI roda melhor em Node) |
| Python | `3.13` | Latest stable. `apps/chat` (Agno) e `apps/worker` (extração de mídia + ARQ) |
| pnpm | `9.x` | Package manager monorepo TS |
| uv | latest | Package manager Python (substitui pip/poetry — mais rápido e moderno) |

## Frameworks e libs

### `apps/web` (TypeScript)

| Lib | Versão | Função |
|---|---|---|
| `hono` | `^4` | HTTP server (rotas + middleware) |
| `react`, `react-dom` | `^18` | Front-end |
| `vite` | `^5` | Build + dev server |
| `@vitejs/plugin-react` | `^4` | React em Vite |
| `tailwindcss` | `^4` | CSS utilitário, novo `@theme` |
| `shadcn/ui` | latest | Componentes (zinc theme) |
| `better-auth` | `^1` | Auth (email/senha + Prisma adapter) |
| `prisma`, `@prisma/client` | `^6` | ORM |
| `zod` | `^3` | Validação de schemas (input/output) |
| `eslint` | `^9` | Lint TS |
| `prettier` | `^3` | Formatação |
| `typescript` | `^5.6` | TS compiler |
| `vitest` | `^2` | Testes TS (compatível com Bun também) |
| `@playwright/test` | `^1.49` | Testes E2E |

### `apps/chat` (Python)

| Lib | Versão | Função |
|---|---|---|
| `fastapi` | `^0.115` | HTTP server async |
| `uvicorn[standard]` | latest | ASGI server |
| `agno` | latest | Framework de agente (tools, memory, streaming) |
| `openai` | latest | Cliente OpenRouter (API compat OpenAI) |
| `httpx` | `^0.27` | HTTP client async |
| `asyncpg` | `^0.30` | Postgres driver (queries diretas pras tools) |
| `pydantic` | `^2` | Schemas |
| `cryptography` | latest | Decrypt master-key-cifrado secrets |
| `ruff` | latest | Lint Python |
| `mypy` | latest | Type check |
| `pytest`, `pytest-asyncio` | latest | Testes |

### `apps/worker` (Python)

| Lib | Versão | Função |
|---|---|---|
| `arq` | `^0.26` | Async Redis queue |
| `yt-dlp` | latest | Motor interno atual do extrator de mídia multi-plataforma |
| `httpx` | `^0.27` | Chamadas OpenRouter |
| `asyncpg` | `^0.30` | Postgres driver |
| `pydantic` | `^2` | Schemas |
| `boto3` ou `aiobotocore` | latest | Cliente S3-compatible (MinIO/Garage/AWS) |
| `structlog` | latest | Logs estruturados |
| `cryptography` | latest | Decrypt secrets |
| `ruff`, `mypy`, `pytest` | latest | Tooling |

### Sistema (no container worker)

| Tool | Versão | Função |
|---|---|---|
| `ffmpeg` | `>=7` (apt) | Extração de áudio + chunking |

## Infraestrutura

| Componente | Imagem | Versão | Função |
|---|---|---|---|
| Postgres | `postgres:17-alpine` | 17.x | DB principal |
| Redis | `redis:7-alpine` | 7.x | Fila ARQ + cache |
| MinIO | `minio/minio` | latest | Object storage S3-compatible |

## Tooling de CI

| Tool | Função |
|---|---|
| GitHub Actions | Runner do CI |
| `actions/setup-node@v4` | Setup Node 22 |
| `oven-sh/setup-bun@v2` | Setup Bun 1.2 |
| `astral-sh/setup-uv@v3` | Setup uv (Python 3.13) |
| `aquasecurity/trivy-action` | Container + filesystem scan |
| `github/codeql-action` | SAST TS/JS |
| `pypa/gh-action-pip-audit` | Audit deps Python |
| `gitleaks/gitleaks-action` | Secret scanning |
| `docker/build-push-action@v6` | Build + push pra ghcr.io |

## Política de upgrade

- **Patch**: bot Dependabot via PRs (auto-merge se CI verde, pra deps confiáveis)
- **Minor**: PR manual com revisão e validação local (`make test && make typecheck`)
- **Major**: PR com nota de migração em `docs/DECISIONS.md` (ADR) e validação completa

## Decisões correlatas

- ADR-002 `docs/DECISIONS.md`: monorepo TS+Python sem Turbo
- ADR-004 `docs/DECISIONS.md`: Postgres FTS em vez de pgvector
- ADR-005 `docs/DECISIONS.md`: ARQ em vez de BullMQ
