# Stack — Voxen

Versões fixadas e justificativas. Atualizar este arquivo SEMPRE que mudar uma versão major/minor.

## Runtimes e linguagens

| Tecnologia | Versão | Por quê |
|---|---|---|
| Bun | `>=1.2` (CI `1.2.x`; imagens Docker `1.3`) | Runtime do `apps/web`. Rápido, suporta TS nativo, ótimo dev experience |
| Node | `22 LTS` | Compatibilidade com tooling que ainda não cobre Bun (Prisma CLI roda melhor em Node) |
| Python | `3.13` | Latest stable. `apps/chat` (Agno) e `apps/worker` (asyncio + jobs duráveis no Postgres) |
| pnpm | `9.x` | Package manager monorepo TS |
| uv | latest | Package manager Python (substitui pip/poetry — mais rápido e moderno) |

## Frameworks e libs

### `apps/web` (TypeScript)

| Lib | Versão | Função |
|---|---|---|
| `hono` | `^4` | HTTP server (rotas + middleware) |
| `react`, `react-dom` | `^19` | Front-end |
| `vite` | `^6` | Build + dev server |
| `@vitejs/plugin-react` | `^4` | React em Vite |
| `tailwindcss` | `^4` | CSS utilitário, novo `@theme` |
| `shadcn/ui` | latest | Componentes (zinc theme) |
| `better-auth` | `^1` | Auth (email/senha + Prisma adapter) |
| `prisma`, `@prisma/client` | `^6` | ORM |
| `zod` | `^4` | Validação de schemas (input/output) |
| `eslint` | `^9` | Lint TS |
| `prettier` | `^3` | Formatação |
| `typescript` | `^5.6` | TS compiler |
| `vitest` | `^3` | Testes TS (compatível com Bun também) |

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
| `asyncio` + `asyncpg` | stdlib / `^0.30` | Claim, lease, heartbeat e recovery da fila durável no Postgres |
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
| Redis | `redis:7-alpine` | 7.x | Wakeup/realtime efêmeros + cache; não é a fonte durável da fila |
| MinIO | `minio/minio` | latest | Object storage S3-compatible |

## Tooling de CI

| Tool | Função |
|---|---|
| GitHub Actions | Runner do CI |
| `actions/setup-node@v6` | Setup Node 22 |
| `oven-sh/setup-bun@v2` | Setup Bun 1.2 |
| `pnpm/action-setup@v6` | Setup pnpm |
| `actions/setup-python@v6` | Setup Python 3.13 |
| `astral-sh/setup-uv@v8.1.0` | Setup uv (Python 3.13) |
| `actions/dependency-review-action@v5` | Review de dependências em PR |
| `aquasecurity/trivy-action@v0.36.0` | Container + filesystem scan |
| `github/codeql-action` | SAST TS/JS |
| `pypa/gh-action-pip-audit` | Audit deps Python |
| `gitleaks/gitleaks-action` | Secret scanning |
| `docker/build-push-action@v7` | Build + push pra ghcr.io |

## Política de upgrade

- **Patch**: bot Dependabot via PRs (auto-merge se CI verde, pra deps confiáveis)
- **Minor**: PR manual com revisão e validação local (`make test && make typecheck`)
- **Major**: PR com nota de migração em `docs/DECISIONS.md` (ADR) e validação completa

## Decisões correlatas

- ADR-002 `docs/DECISIONS.md`: monorepo TS+Python sem Turbo
- ADR-004 `docs/DECISIONS.md`: Postgres FTS em vez de pgvector
- ADR-005 `docs/DECISIONS.md`: decisão histórica de ARQ, substituída pela fila durável no Postgres
