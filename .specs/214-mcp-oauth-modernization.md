# Spec 214 — Compatible OAuth modernization and metadata-document clients

## Context

MCP audit MCP-11 identified a required Better Auth 1.7 migration and client-ID
metadata document (CIMD) compatibility for current MCP clients. The owner approved
completing the audit backlog and will provide an account connection after the
server is ready. Existing users, sessions, OAuth clients/grants and encrypted SSO
configuration must survive the upgrade.

## Requirements

### Ubiquitous

- The system shall upgrade Better Auth and its enabled packages together to the verified current maintenance release.
- The system shall bind OAuth tokens, clients and grants to the canonical MCP resource with explicit scopes and short access-token lifetime.
- The system shall preserve existing account identities, sessions, client identifiers, grants, refresh tokens and signing keys through reviewed additive migrations.
- The system shall preserve the encrypted SSO adapter and its management boundaries.
- The system shall maintain PKCE, consent, approval, revocation and least-privilege checks.
- The Bearer MCP transport shall reject sender-constrained tokens while preserving their revocation.

### Event-driven

- When a client identifies itself by an HTTPS metadata document, the system shall discover and validate it through a DNS-pinned, public-address-only transport with no redirects and bounded time/bytes.
- When a native client uses a varying loopback port, the system shall allow only the registered loopback host and path, without broad wildcard redirects.
- When old short-lived access tokens overlap the rollout, the system shall recognize their original claim format without expanding accepted audience or scopes.
- When existing refresh tokens are used after rollout, the system shall retain the original client/user/resource grant and replay protection.

### Unwanted behavior

- If metadata resolves to any private or special-use address, changes hostname/TLS identity, redirects, exceeds bounds, or has an invalid document, then the system shall reject discovery.
- If client, consent or user authorization has been revoked or disabled, then the system shall reject access immediately.
- If the canonical resource or OAuth storage is unavailable, then the system shall fail closed without exposing secrets.

## Acceptance criteria

- [x] Reviewed package APIs and official upgrade/CIMD guidance match the implementation.
- [x] Additive schema/migration and resource backfill preserve pre-upgrade identities and credentials.
- [x] Login, encrypted SSO, PKCE/consent, refresh/replay, revocation and scope regressions pass.
- [x] Metadata transport has adversarial DNS/TLS/redirect/body/deadline tests on the actual Bun runtime.
- [x] Metadata client registration and strict dynamic loopback callbacks pass an end-to-end OAuth flow.
- [x] Current and overlapping legacy JWTs remain resource-bound and revocable.
- [x] Discovery/UI/docs accurately advertise supported behavior.
- [x] Full checks, migration/quality gates, real image build and independent review pass.
- [ ] Native deployment preserves settings/storage and passes live authorization and MCP probes.

## Primary references

- https://better-auth.com/docs/guides/1-7-upgrade-guide
- https://better-auth.com/docs/plugins/cimd
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization

## Decisions

Use the OAuth provider's canonical registration and resource mechanisms. Adapt
only the boundaries required by Voxen. Do not replace existing sessions, keys or
user data, loosen redirect/origin checks, or weaken repository quality gates.

## Validation

Actual 1.6.25-issued session, JWT and refresh credentials passed the 1.7.7 cutover
probe: password/client-secret hashes and signing-key bytes stayed unchanged;
legacy access remained revocable and refresh renewed with the original grant.
Backfill idempotence and data preservation regressions passed. Metadata client
OAuth/PKCE with changing loopback port passed, including consent, issuer response,
client-resource unlink and session deletion. Existing login/SSO/OAuth regressions
passed after adapting provider row locking and transaction-scoped identity reads.
Verified pending SSO accounts commit without a session; denied registration
returns the provider's generic response without persisting an identity. A real
TLS fixture accepts its trusted matching certificate and rejects an otherwise
trusted certificate for another hostname on Bun. The actual Bun pinned-address probe rejected a connection to the selected
alternate public address; bounded transport unit cases passed. Full gates, UI
verification and final independent review passed; deployment remains pending.

Final boundary regression: a real provider-issued DPoP JWT was accepted as
Bearer before the correction (RED). The resource now rejects its confirmation
claim; its revocation still persists, and ordinary Bearer access remains valid
(GREEN). The UI passed both locales, all client selection/copy controls, four
themes and mobile with the existing session. Final gates/build passed after this boundary correction: 1,776 web tests,
125 extension tests and 559 worker tests; coverage/duplication and dependency
audits passed. The combined Docker Compose image built successfully. The final
OAuth regression also passed on Bun 1.2, and independent review approved the
corrective commit. Native deployment and account-client validation follow.
