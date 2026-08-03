# Voxen Documentation

English | [Português (Brasil)](../README.md)

Voxen is a self-hosted web platform for multimodal knowledge bases. It ingests videos, audio, images, documents, and web pages, stores structured Markdown transcripts, and provides an agentic chat interface over the collection.

Voxen is not a hosted SaaS. It is designed for individuals and small teams that run the stack on their own server and keep control over data, credentials, models, and users.

## Quick Start

Requirements: Docker and Docker Compose v2.

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Open `http://localhost:3000`. The first account becomes the administrator and
is sent to onboarding, where it adds the OpenRouter API key; Voxen validates
the account and applies the canonical models automatically.

## Documentation Map

| Document                                       | Topic                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`DEVELOPMENT.md`](DEVELOPMENT.md)             | Local development, commands, tests, SDD/TDD, and contribution workflow                |
| [`DEPLOY.md`](DEPLOY.md)                       | Production deployment on home-lab, VPS, Proxmox, nginx, Docker Compose, and Easypanel |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)           | Apps, services, main flows, and architecture decisions                                |
| [`STACK.md`](STACK.md)                         | Runtime, libraries, infrastructure images, CI tooling, and upgrade policy             |
| [`DECISIONS.md`](DECISIONS.md)                 | Architecture Decision Records                                                         |
| [`SECURITY.md`](SECURITY.md)                   | Threat model, auth, secrets, SSRF prevention, CI security, and incident response      |
| [`TRANSCRIPT-FORMAT.md`](TRANSCRIPT-FORMAT.md) | Canonical Markdown transcript format                                                  |

## Core Workflow

1. A user submits a URL or uploads supported media.
2. `apps/web` creates a job and stores metadata.
3. `apps/worker` extracts media, downloads captions when available, transcribes audio when needed, and writes a Markdown transcript to S3-compatible storage.
4. Postgres mirrors searchable plain text and metadata.
5. `apps/chat` uses deterministic tools over Postgres FTS and S3 transcripts to answer questions.

## Branch and Release Flow

- `main` is the default and stable release branch.
- `dev` is the protected integration branch.
- Feature and maintenance PRs target `dev`.
- Stable releases are prepared from `dev` and merged into `main` by release PR.
- After a release, `main` is synchronized back into `dev`.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full contribution flow.
