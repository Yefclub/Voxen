# Contributing to Voxen

Thank you for contributing. Voxen is a self-hosted project focused on simple
operation, data sovereignty, and safe maintenance. Contributions are welcome
when they preserve those principles.

## Before you start

- Read the [README](README.md), [development guide](docs/en/DEVELOPMENT.md),
  [architecture](docs/en/ARCHITECTURE.md), and [security model](docs/en/SECURITY.md).
- Open a reproducible bug report for defects.
- Discuss large features in an issue before implementation.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Branch workflow

- `main` is the protected stable release branch.
- `dev` is the protected integration branch.
- Feature and maintenance pull requests target `dev`.
- Pull requests to `main` are releases and require exactly one of
  `release:patch`, `release:minor`, or `release:major`.

Use a focused branch name:

```text
feat/my-feature
fix/my-bug
docs/my-guide
chore/my-maintenance
```

## Local setup

Minimum requirements are Git, Docker, and Docker Compose v2.

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Running tooling outside containers additionally requires Bun, pnpm, Python,
and uv in the versions documented in [STACK.md](docs/en/STACK.md).

## Quality checks

Run the relevant checks before opening a pull request:

```bash
make format-check
make lint
make typecheck
make test
docker compose build
```

Use `make format` to apply automated formatting.

TypeScript uses ESLint and Prettier. Avoid `any`, validate API input with Zod,
and keep handlers small and testable. Python uses Ruff, strict mypy, mandatory
type hints in application code, and Pydantic at data boundaries.

Every bug fix or behavior change should include a regression test. Schema
changes require a Prisma migration and, where relevant, an upgrade-path test.

## Commits and pull requests

Use English Conventional Commits:

```text
feat(web): add job filter
fix(worker): recover interrupted transcription
docs(deploy): document Cloudflare Tunnel
ci(security): update secret scanner
```

A good pull request explains the problem and solution, identifies critical
files, lists the tests that ran, updates affected documentation, and stays small
enough to review. Changes spanning more than two files should normally start
with an EARS specification under `.specs/NNN-slug.md`.

Do not include AI attribution, generated-by footers, or co-authorship trailers
in commits, pull requests, issues, documentation, or code.

## Dependency licenses

New dependencies must use a permissive license such as MIT, Apache-2.0, BSD, or
ISC. Avoid GPL, AGPL, SSPL, or licenses that impose incompatible obligations.
