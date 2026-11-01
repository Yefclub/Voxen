# Stack — Voxen

This file tracks supported runtimes, major libraries, infrastructure, and the
upgrade policy.

## Runtimes

| Technology | Supported version | Purpose                                      |
| ---------- | ----------------: | -------------------------------------------- |
| Bun        |           `>=1.2` | `apps/web` runtime and TypeScript tests      |
| Node.js    |          `22 LTS` | Prisma, release, and CI tooling              |
| pnpm       |             `9.x` | TypeScript workspace management              |
| uv         |           current | Python dependency and environment management |

## Web

| Library                        | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| Hono                           | HTTP API and route composition            |
| React 19 + React Router 7      | SPA and routing                           |
| Vite 6                         | Front-end build and development           |
| Tailwind CSS 4                 | Styling system                            |
| Better Auth + SSO plugin       | Email/password auth and optional OIDC SSO |
| Prisma 6                       | Postgres access and migrations            |
| MCP SDK                        | User-scoped MCP server access             |
| Zod 4                          | Input validation                          |
| Vitest / Bun test              | TypeScript tests                          |

## Infrastructure

| Component | Reference image      | Purpose                                          |
| --------- | -------------------- | ------------------------------------------------ |
| Postgres  | `postgres:17-alpine` | Primary database, FTS, graph state, durable jobs |
| Redis     | `redis:7-alpine`     | Wakeups, realtime events, cache, rate limits     |
| Local volume | Docker named volume | Default single-host transcript/media storage  |
| MinIO     | `quay.io/minio/minio` | Optional S3-compatible object storage profile  |

Production may use compatible managed Postgres, Redis, or S3 services. The
application remains self-hosted and does not require a managed Voxen service.

## CI and Security

GitHub Actions runs formatting, lint, type checks, tests, Prisma migration
validation, dependency review, CodeQL, Trivy, dependency audits, and secret
scanning. Stable releases publish the combined `ghcr.io/yefclub/voxen` image.

## Upgrade Policy

- Patches: review and merge when CI and security gates pass.
- Minors: require local validation and compatibility review.
- Majors: require a migration note or ADR when contracts change.
- Temporary advisory exceptions require a documented scope, owner, and review
  date.
