# Security — Voxen

Voxen is self-hosted and intended for restricted adoption. The deployment
owner controls the host, secrets, model keys, identity providers, and user
approvals.

Report vulnerabilities through [`../../SECURITY.md`](../../SECURITY.md).

## Threat Model

| Threat                  | Vector                    | Mitigation                                                                |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Brute-force login       | Public auth endpoints     | Rate limits, strong password hashing, optional external identity provider |
| SSRF                    | Malicious ingestion URL   | URL validation and public-host allowlists before extraction               |
| Cross-user access       | Forged identifiers        | Session-derived `userId` on every user-owned query and tool               |
| Privilege escalation    | Administrative routes     | Server-side role guards; role never accepted from request input           |
| Secret exposure         | Database or log leak      | AES-256-GCM encrypted settings and secret-safe logs                       |
| Supply-chain compromise | Packages, actions, images | Lockfiles, dependency review, audits, CodeQL, Trivy, and gitleaks         |

## Authentication and Authorization

Voxen uses Better Auth with database-backed, HTTP-only sessions. Local
email/password authentication is always available. An administrator can
optionally configure one OIDC SSO provider, restrict email domains, and control
automatic approval for trusted identities.

The first account in an empty instance becomes the administrator. Later local
accounts remain pending until approved. Account states are `PENDING`,
`APPROVED`, `REJECTED`, and `DISABLED`.

Administrator configuration is role-protected under `/admin/*`. Personal
profile, platform-account sessions, and MCP credentials are owned by the
authenticated user under `/conta/*`.

## User Isolation

- Derive `userId` from the server session, never body or query input.
- Scope transcripts, notes, jobs, graph entities, costs, conversations,
  integrations, and agent tools by that `userId`.
- Keep administrator all-user views explicit and role-guarded.
- Persist platform model configuration globally while keeping personal data
  and third-party account sessions isolated.

## Secrets

Infrastructure secrets live only in the root `.env`. Runtime application
secrets such as OpenRouter and OIDC credentials are stored encrypted with
AES-256-GCM using `MASTER_KEY`.

```bash
openssl rand -base64 32
```

Back up `MASTER_KEY` separately. Losing it makes encrypted application settings
unrecoverable. Never log passwords, API keys, access tokens, cookies, or the
master key.

## Network and Content Safety

- The web service is the only public application port.
- Worker extraction uses argument arrays, timeouts, isolated temporary
  directories, and no shell interpolation.
- Supported remote URLs are validated before media tools run.
- Local storage rejects absolute/traversal keys and symlinks, uses restrictive
  modes, atomic writes, and is never exposed as a public static directory.
- Optional S3 credentials should be limited to the Voxen bucket.
- Transcript anchors are verified against the current user-owned canonical
  source and retain its version/checksum; cross-user identifiers are hidden.
- External research is untrusted and review-gated. Uncited output fails closed,
  suggested or stale output is excluded from retrieval, and rendered Markdown
  cannot enable raw HTML or unsafe URL execution.
- The optional reverse proxy agent uses TLS, a high-entropy encrypted token,
  and a localhost-only SOCKS endpoint.

## CI Security

Pull requests and scheduled workflows cover dependency review, CodeQL, Trivy,
Python and pnpm audits, Prisma migration validation, and secret scanning.
Repository workflow tokens default to read-only; individual jobs request only
the permissions they require.

### Time-Bound Dependency Exception

The React Router advisory `GHSA-qwww-vcr4-c8h2` affects unstable React Server
Components. Voxen is a Vite `BrowserRouter` SPA and does not use React Server
Components, so the finding is accepted as non-applicable until a compatible
patched release is available. Review owner: maintainers. Review date:
2026-09-01.

No other high or critical production advisory may be allowlisted without a
documented scope, owner, and review date.

## Incident Response

1. Rotate affected host, application, OIDC, and model credentials.
2. Revoke affected sessions and disable compromised accounts.
3. Inspect authentication, job, automation, and cost events.
4. Restore PostgreSQL, the selected storage backend, and `MASTER_KEY` backups when required.
5. Publish a patch release and disclose impact through the security policy.
