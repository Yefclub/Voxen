# Development — Voxen

This guide explains how to run Voxen locally, validate changes, and contribute
safely.

## Requirements

- Docker and Docker Compose v2
- Git

Optional for running tooling outside containers:

- Bun 1.2+
- Node.js 22 and pnpm 9+
- Python 3.13 with `uv`

## Initial Setup

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

`make dev` creates or completes the root `.env` and starts Postgres, Redis,
MinIO, web, and worker. Open `http://localhost:3000`; the first account becomes
the administrator and enters onboarding.

## Daily Commands

```bash
make help          # list available targets
make dev           # start and build the local stack
make down          # stop containers and keep volumes
make update        # rebuild and recreate without removing data
make logs          # follow service logs
make ps            # show service status

make test          # scripts, web, extension, and worker tests
make test-ts       # web tests only
make test-py       # worker tests only
make lint          # ESLint and Ruff
make format-check  # Prettier and Ruff formatting checks
make typecheck     # TypeScript and mypy
make build         # build the Compose images

make migrate       # apply Prisma migrations
make backup        # back up Postgres, object storage, and MASTER_KEY
make clean         # destructive: remove containers, volumes, and data
```

## Spec-Driven Development

Create or update `.specs/NNN-slug.md` before a non-trivial change. The spec is
the implementation contract and should cover scope, non-goals, requirements,
acceptance criteria, validation, and rollout notes.

Use a failing test or gate to reproduce behavior before implementation when a
deterministic test is practical. Migration changes must also pass the Prisma
migration gate.

## Validation Expectations

- `apps/web`: lint, typecheck, tests, and formatting checks
- `apps/worker`: Ruff, mypy, pytest, and formatting checks
- extension changes: extension tests and packaging
- Docker/runtime changes: `docker compose config -q` and image builds
- UI changes: local browser verification of affected states and responsive
  layouts
- public documentation: verify relative links and both language tracks

The complete repository gate is:

```bash
make format-check
make lint
make typecheck
make test
docker compose config -q
docker compose build
```

## Git Workflow

- `main`: protected stable releases
- `dev`: protected integration branch
- work branches: created from an updated `dev`

Every change targets `dev` first. CI and an independent review must complete
before squash merge. A release PR promotes the validated state from `dev` to
`main`; the resulting `main` commit is then synchronized back into `dev`.

Stable release PRs are titled exactly `vX.Y.Z`. The stable squash commit also
uses exactly that title and an empty body so release history remains clean.
