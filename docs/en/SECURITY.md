# Security — Voxen

Voxen is self-hosted and intended for restricted adoption. The deployment owner controls the host, secrets, model keys, and user approvals.

Report vulnerabilities through the public policy in [`../../SECURITY.md`](../../SECURITY.md).

## Threat Model

| Threat | Vector | Mitigation |
|---|---|---|
| Brute-force login | Internet-facing auth endpoints | Auth rate limits and strong password hashing |
| SSRF | Malicious job URLs | Worker URL allowlist before extraction |
| Cross-user data access | Internal user requests | `userId` scoping on queries and route guards |
| Secret exposure through DB dumps | Database backup leak | Encrypted settings with `MASTER_KEY` |
| Supply chain compromise | npm, Python, images | Dependabot, audits, CodeQL, Trivy, gitleaks |
| Datacenter media blocks | YouTube/VPS soft-blocks | Home-lab recommendation and optional extraction proxy |

## Core Principles

- Validate all external input with Zod or Pydantic.
- Require authentication on application routes except health and auth endpoints.
- Scope every user-owned query by `userId`.
- Keep admin routes role-protected.
- Never log passwords, API keys, tokens, or `MASTER_KEY`.
- Keep `.env` out of git.

## Auth

Voxen uses Better Auth with email and password. Sessions are stored in the database and cookies are HTTP-only. New users are pending until approved unless they are the first account in an empty instance.

User status values:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `DISABLED`

Only approved users can use the application.

## Secrets

Infrastructure secrets live in the root `.env`. Application secrets, such as OpenRouter keys, are stored in the database encrypted with AES-256-GCM using `MASTER_KEY`.

Generate `MASTER_KEY` with:

```bash
openssl rand -base64 32
```

Losing `MASTER_KEY` means encrypted application secrets cannot be decrypted.

## SSRF Prevention

The worker validates source URLs before invoking media extraction. Only explicitly supported public media hosts should pass. This prevents the extractor and ffmpeg from becoming arbitrary network fetchers.

## Subprocess Safety

Media extraction and ffmpeg run as subprocesses. Safe usage requires:

- no `shell=True`
- arguments passed as arrays
- job-specific temporary directories
- timeouts
- cleanup after success and failure

## CI Security

The security workflow covers:

- dependency review
- CodeQL
- Trivy filesystem and image scan
- Python dependency audit
- pnpm audit
- gitleaks

Security automation should support the `dev` to `main` release flow. Auto-fixes that bypass the integration branch should stay disabled or be handled manually.

## Incident Response

1. Rotate compromised host and application credentials.
2. Revoke affected sessions.
3. Inspect auth, job, and cost events for anomalies.
4. Restore from Postgres, object storage, and `MASTER_KEY` backups when needed.
5. Publish a patch release if code changes are required.
