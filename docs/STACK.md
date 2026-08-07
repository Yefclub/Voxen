# Stack — Voxen

## Runtimes

| Tecnologia | Versão suportada | Função                         |
| ---------- | ---------------: | ------------------------------ |
| Bun        |          `>=1.2` | runtime e testes do `apps/web` |
| Node.js    |         `22 LTS` | Prisma, release e CI           |
| Python     |           `3.13` | `apps/worker`                  |
| pnpm       |            `9.x` | workspace TypeScript           |
| uv         |            atual | dependências Python            |

## Web e agente integrado

| Biblioteca                     | Função                          |
| ------------------------------ | ------------------------------- |
| Hono                           | API HTTP                        |
| React 19 + React Router 7      | SPA e rotas                     |
| AI SDK 7 + provider OpenRouter | agente, ferramentas e streaming |
| Vite 6                         | build do front-end              |
| Tailwind CSS 4                 | estilos                         |
| Better Auth + SSO              | email/senha e OIDC opcional     |
| Prisma 6                       | Postgres e migrations           |
| MCP SDK                        | acesso MCP isolado por usuário  |
| Zod 4                          | validação                       |

## Worker

| Biblioteca ou ferramenta | Função                                        |
| ------------------------ | --------------------------------------------- |
| asyncio + asyncpg        | jobs duráveis, leases e heartbeat no Postgres |
| yt-dlp e helpers         | extração de mídia                             |
| ffmpeg                   | extração e segmentação de áudio               |
| httpx                    | OpenRouter e requests remotos                 |
| Pydantic                 | schemas                                       |
| aioboto3                 | driver opcional de storage S3                |
| structlog                | logs estruturados                             |
| Ruff, mypy, pytest       | lint, tipos e testes                          |

## Infraestrutura

| Componente | Imagem               | Função                                |
| ---------- | -------------------- | ------------------------------------- |
| Postgres   | `postgres:17-alpine` | DB, FTS, grafo e fila durável         |
| Redis      | `redis:7-alpine`     | wakeup, realtime, cache e rate limits |
| Volume local | volume nomeado Docker | storage padrão em um único host    |
| MinIO      | `minio/minio`        | profile opcional S3-compatible        |

O CI executa formatação, lint, tipos, testes, validação de migrations, CodeQL,
Trivy, revisão/auditoria de dependências e gitleaks. Releases publicam a imagem
combinada `ghcr.io/yefclub/voxen`; `voxen-proxy-agent` permanece separado por
ser opcional.

Patches passam por CI e revisão; minors exigem validação de compatibilidade;
majors exigem nota de migração ou ADR quando alteram contratos. Exceções de
segurança precisam de escopo, responsável e data de revisão.
