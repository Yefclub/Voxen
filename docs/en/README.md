# Voxen Documentation

English | [Português (Brasil)](../README.md)

Voxen is a self-hosted web platform for prepared knowledge bases. Externally prepared content is stored with provenance and retrieved fast and precisely over MCP. Voxen can also capture links and files itself: the `capture-worker` container downloads the content and the web app interprets it with the cloud AI provider each user configures (OpenAI, Anthropic, OpenRouter, or xAI). There are no local models and no embeddings, and the knowledge base works without any provider key.

Voxen is not a hosted SaaS. It is designed for individuals and small teams that run the stack on their own server and keep control over data and users.

## Quick Start

Requirements: Docker and Docker Compose v2.

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Open `http://localhost:3000`. The first account becomes the administrator and
completes onboarding with instance language and timezone — no provider
account, key, or model configuration is required. Link capture is optional:
each user adds a provider key under Account → AI providers (`/conta/ia`) and
then pastes a link, uploads a file, or shares from the installed PWA to
`/capturar`.

## Documentation Map

| Document                                       | Topic                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`DEVELOPMENT.md`](DEVELOPMENT.md)             | Local development, commands, tests, SDD/TDD, and contribution workflow                |
| [`DEPLOY.md`](DEPLOY.md)                       | Production deployment on home-lab, VPS, Proxmox, nginx, Docker Compose, and Easypanel |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)           | Apps, services, main flows, and architecture decisions                                |
| [`STACK.md`](STACK.md)                         | Runtime, libraries, infrastructure images, CI tooling, and upgrade policy             |
| [`DECISIONS.md`](DECISIONS.md)                 | Architecture Decision Records                                                         |
| [`SECURITY.md`](SECURITY.md)                   | Threat model, auth, secrets, SSRF prevention, CI security, and incident response      |
| [`MCP.md`](MCP.md)                             | MCP client setup, compatibility, security, and troubleshooting                        |
| [`TRANSCRIPT-FORMAT.md`](TRANSCRIPT-FORMAT.md) | Canonical Markdown transcript format                                                  |

## Core Workflow

1. An external producer publishes prepared content through the versioned
   HTTP/MCP ingestion contract (idempotent, with provenance).
2. `apps/web` validates, stores, and deterministically indexes it.
3. Postgres mirrors searchable plain text and metadata.
4. MCP clients retrieve passages with source-backed locations through
   filtered search and progressive reads.

Capture adds a second entry point: a link or file becomes a durable capture
job; the worker extracts text, audio, and images; the web app transcribes
audio only when no text exists, interprets the content with one structured
model call, and publishes a document through the same storage and index.

## Branch and Release Flow

- `main` is the default and stable release branch.
- `dev` is the protected integration branch.
- Feature and maintenance PRs target `dev`.
- Stable releases are prepared from `dev` and merged into `main` by release PR.
- After a release, `main` is synchronized back into `dev`.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full contribution flow.
