# Development — Voxen

This guide explains how to run Voxen locally, validate changes, and contribute safely.

## Requirements

- Docker and Docker Compose v2
- Git

Optional for running tooling outside containers:

- Bun 1.2+
- pnpm 9+
- Python 3.13 with `uv`

## Initial Setup

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

`make dev` creates or completes `.env` when needed and starts Postgres, Redis, MinIO, web, chat, and worker. The `voxen-transcripts` bucket is created automatically.

Open `http://localhost:3000`. The first registered user becomes the approved admin and enters onboarding.

## Daily Commands

```bash
make help                  # list available targets
make dev                   # start the full local stack
make down                  # stop containers, keep volumes
make restart               # restart the stack
make logs                  # tail service logs
make ps                    # show service status

make test                  # run TypeScript and Python tests
make test-ts               # web tests only
make test-py               # chat and worker tests only

make lint                  # eslint + ruff check
make format                # prettier + ruff format
make format-check          # formatting check only
make typecheck             # TypeScript + mypy

make migrate               # apply Prisma migrations
make shell-db              # open psql in Postgres
make shell-redis           # open redis-cli
make minio-init            # recreate MinIO bucket if needed
make master-key-show       # print MASTER_KEY; handle as a secret
make clean                 # destructive: removes volumes and data
```

## Spec-Driven Development

For non-trivial features, create or update a spec in `.specs/NNN-slug.md` before implementation. A non-trivial change is any change that touches multiple surfaces, changes API behavior, changes persistence, or affects user-visible workflows.

Specs should state:

- scope and non-goals
- functional requirements
- acceptance criteria
- validation plan
- rollout or migration notes when needed

## Testing Expectations

Use focused validation for small changes and broaden coverage for shared behavior.

- `apps/web`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`
- `apps/chat`: `ruff check`, `ruff format --check`, `pytest`
- `apps/worker`: `ruff check`, `ruff format --check`, `pytest`
- Docker runtime changes: `docker compose build <service>`
- UI changes: verify affected screens locally before merging

## Git Workflow

Branches:

- `main`: protected stable release branch
- `dev`: protected integration branch
- `codex/<slug>`, `feat/<slug>`, `fix/<slug>`, `docs/<slug>`: work branches created from updated `dev`

Flow:

1. Fetch and update `dev`.
2. Create a small branch from `dev`.
3. Implement the change and keep the diff reviewable.
4. Run relevant local validations.
5. Open a PR against `dev`.
6. Wait for CI and security checks.
7. Merge only after policies and reviews are satisfied.

## Versioning

Stable versions use SemVer tags on `main`, for example `v0.7.4`. Development builds on `dev` use generated pre-release metadata tied to the commit.

Release flow:

1. Prepare the patch, minor, or major version from `dev`.
2. Open a release PR to `main` with the matching release label.
3. After merge, the release workflow creates the tag and GitHub Release.
4. Synchronize `main` back into `dev`.

