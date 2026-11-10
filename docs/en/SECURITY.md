# Security — Voxen

Voxen is self-hosted and intended for restricted adoption. The deployment
owner controls the host, secrets, model keys, identity providers, and user
approvals.

Report vulnerabilities through [`../../SECURITY.md`](../../SECURITY.md).

## Threat Model

| Threat                  | Vector                    | Mitigation                                                                |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Brute-force login       | Public auth endpoints     | Rate limits, strong password hashing, optional external identity provider |
| SSRF                    | Malicious capture URL     | Submit-time URL checks; worker egress only through Smokescreen            |
| Prompt injection        | Captured page or post     | Tool-free, schema-bound interpretation; content passed as untrusted data  |
| Provider key leak       | Database, logs, API reads | Per-user keys encrypted with `MASTER_KEY`; never returned or logged       |
| Forged share            | Cross-site POST           | Share target needs a session and rejects cross-site `Sec-Fetch-Site`      |
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
- Scope transcripts, notes, jobs, graph entities, and costs by that `userId`.
- Keep administrator all-user views explicit and role-guarded.
- Persist platform configuration globally while keeping personal data
  isolated.

## Secrets

Infrastructure secrets live only in the root `.env`, including
`CAPTURE_WORKER_TOKEN`, which is given only to `web` and `capture-worker`.
Runtime application secrets such as OIDC credentials and each user's AI
provider keys are stored encrypted with AES-256-GCM using `MASTER_KEY`.
Provider keys are entered in the UI (Account → AI providers), validated with a
cheap authenticated call, and never returned to any client: reads expose only
the provider, the last four characters, validation status, and time.

```bash
openssl rand -base64 32
```

Back up `MASTER_KEY` separately. Losing it makes encrypted application settings
unrecoverable. Never log passwords, API keys, access tokens, cookies, or the
master key.

## Network and Content Safety

- The web service is the only exposed application. The capture worker
  publishes no ports, rejects requests without the `CAPTURE_WORKER_TOKEN`
  bearer token, and holds no `MASTER_KEY`, provider key, or database
  credential.
- The worker runs as a non-root user on a read-only root filesystem with all
  capabilities dropped, `no-new-privileges`, and CPU/memory limits. yt-dlp is
  hardened with `--ignore-config --no-plugin-dirs --no-remote-components` and
  `--` before the URL. No cookies, logged-in capture, paid scraping APIs, or
  anti-bot bypass are used; a blocked platform ends with `LOGIN_REQUIRED`,
  `IP_BLOCKED`, `RATE_LIMITED`, or `REMOVED` and suggests uploading the file.
- SSRF: submits are rejected synchronously for non-http(s) URLs, `localhost`,
  and literal private, loopback, or link-local addresses (`BLOCKED_ADDRESS`).
  Every worker request then goes through Smokescreen, which denies private,
  loopback, link-local, and metadata ranges after DNS resolution and
  redirects, so a public URL that redirects inward fails with
  `BLOCKED_ADDRESS` and never reaches the internal address.
- Model requests go only to the fixed endpoints of OpenAI, Anthropic,
  OpenRouter, xAI, and Google Gemini; users cannot set custom base URLs. The
  Gemini key travels only in the `x-goog-api-key` header, never in a URL.
- Prompt injection: interpretation runs with no tools and no web search under
  a strict output schema. Captured text and images are passed as untrusted
  data, and links and images are stripped from the generated summary, so a
  hostile page can at worst distort its own document, not act or exfiltrate.
- The PWA share target (`POST /share-target`) creates jobs only for a signed-in,
  approved user, rejects cross-site `Sec-Fetch-Site`, stores nothing without a
  session, and redirects with ids or fixed error codes only — shared text is
  never rendered as HTML.
- Local storage rejects absolute/traversal keys and symlinks, uses restrictive
  modes, atomic writes, and is never exposed as a public static directory.
- Optional S3 credentials should be limited to the Voxen bucket.
- Transcript anchors are verified against the current user-owned canonical
  source and retain its version/checksum; cross-user identifiers are hidden.
- External research is untrusted and review-gated. Uncited output fails closed,
  suggested or stale output is excluded from retrieval, and rendered Markdown
  cannot enable raw HTML or unsafe URL execution.
- Raw source content is available only to a tool-free planning request.
  Deterministic query validation separates it from tool-enabled search turns;
  provider price ceilings, request/result limits, strict usage proof, and a
  wall-clock deadline fail closed before any result can enter knowledge.
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

1. Rotate affected host, application, OIDC, `CAPTURE_WORKER_TOKEN`, and
   provider credentials (users replace their own keys under Account → AI
   providers).
2. Revoke affected sessions and disable compromised accounts.
3. Inspect authentication, job, automation, and cost events.
4. Restore PostgreSQL, the selected storage backend, and `MASTER_KEY` backups when required.
5. Publish a patch release and disclose impact through the security policy.
