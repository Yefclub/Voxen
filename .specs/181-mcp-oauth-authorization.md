# Spec 181 — MCP OAuth 2.1 authorization

## Context

Voxen's Streamable HTTP MCP server currently authenticates only revocable
personal Bearer tokens. Those credentials remain supported, but clients that
require OAuth discovery cannot connect. OAuth client identity must never become
workspace identity: every delegated credential must resolve to one approved
Voxen user and preserve the existing READ/WRITE tool boundary.

## Requirements

### Ubiquitous

- The MCP resource shall publish RFC 9728 metadata for the canonical `/mcp`
  resource and advertise the Voxen authorization server.
- The authorization server shall publish RFC 8414 metadata, authorization,
  token, registration, JWKS, introspection, and revocation endpoints.
- Authorization-code clients shall use PKCE `S256`; public clients shall never
  require a shared secret.
- Access tokens shall be audience-bound to the exact public `/mcp` resource,
  short-lived, and mapped from `mcp:read`/`mcp:write` to the existing
  READ/WRITE tool authorization.
- OAuth grants, tokens, and clients shall never change the user selected by the
  authenticated Voxen session. Tool input cannot override that identity.
- Existing personal tokens shall continue to authenticate unchanged.
- Client secrets, tokens, authorization codes, refresh tokens, and PKCE
  verifiers shall never be written to application logs or audit payloads.

### Event-driven

- When `/mcp` receives no credential or an invalid OAuth credential, it shall
  return 401 with a Bearer challenge containing `resource_metadata`.
- When a valid OAuth token lacks the required scope, the protected resource
  shall return 403 with `error="insufficient_scope"` and the required scope.
- When authorization requires consent, Voxen shall show the client name,
  redirect host, target resource, and requested scopes to the logged-in user.
- When the user denies consent, no grant shall be created and the client shall
  receive the standard OAuth denial redirect.
- When a user revokes a grant, access through that client shall stop
  immediately even if a JWT has not reached its expiry.
- When RFC 7009 accepts an individual JWT access-token revocation, the
  protected resource shall reject that token immediately and persist only a
  short-lived random signed token identifier. An incorrect, unknown, or blank
  `token_type_hint` shall not prevent revocation.
- RFC 7662 introspection shall report `active: false` when a JWT access token is
  individually revoked, its grant is removed, or its user is no longer
  approved, using the same live policy as the protected MCP resource. Opaque
  refresh-token introspection shall preserve the authorization provider's
  result.
- When an administrator disables OAuth, discovery may remain descriptive, but
  registration, authorization, token issuance, refresh, and OAuth MCP access
  shall fail closed while personal tokens continue to work.
- When an administrator disables a client or a user becomes non-approved,
  already-issued OAuth credentials shall be rejected immediately.
- When a refresh token is used, it shall rotate; reuse of a rotated or revoked
  refresh token shall be rejected and recorded without credential material.

### State-driven

- While `mcp_oauth_enabled` is false, OAuth endpoints that mutate or issue
  authority shall be unavailable and `/mcp` shall not accept OAuth tokens.
- While a grant contains only `mcp:read`, write tools shall not be exposed and
  write calls shall not execute.
- While a client is dynamically registered without authentication, it shall be
  a public client and shall remain subject to exact redirect validation, PKCE,
  consent, a non-spoofable peer limit, a global safety limit, and fail-closed
  rate-limit storage.
- While an OAuth grant exists, the account page shall let only its owner list
  and revoke it; administrators may disable clients but never inherit a user's
  workspace access.

### Unwanted behavior

- If `resource` or token audience differs from the canonical public `/mcp`
  URI, authorization or resource access shall fail.
- If a redirect uses a wildcard, credentials, an unsafe scheme, or a non-exact
  value, registration/authorization shall fail; exact loopback HTTP callbacks
  are the only non-HTTPS exception.
- If PKCE is missing, downgraded to `plain`, mismatched, expired, or reused,
  token issuance shall fail.
- If client input contains a user/workspace identifier, it shall not affect the
  user bound to the session and token.
- If audit metadata resembles a credential or contains authorization payloads,
  the audit writer shall redact or reject it.

## Acceptance criteria

- [x] Protected-resource metadata and authorization-server discovery work at
      canonical and compatibility well-known paths.
- [x] 401/403 Bearer challenges contain correct metadata and scope parameters.
- [x] Public-client authorization code + PKCE `S256` succeeds end to end.
- [x] Missing/downgraded/mismatched/reused PKCE and unsafe redirects fail.
- [x] Consent approval and denial are explicit, localized, and user-bound.
- [x] `mcp:read` cannot expose or execute write tools; `mcp:write` maps to the
      existing WRITE boundary without exposing administrative tools.
- [x] Wrong audience, expiry, revoked grant, disabled client, and non-approved
      user are rejected immediately.
- [x] Refresh tokens rotate and reuse is rejected.
- [x] RFC 7009 access-token revocation takes effect immediately.
- [x] RFC 7009 token hints are treated as hints, and RFC 7662 introspection
      reflects live revocation, grant, and user policy.
- [x] Users can revoke their grants; administrators can control the global
      capability and disable clients.
- [x] Audit events cover registration, consent, issuance/refresh, revocation,
      rejection, and policy changes without secrets.
- [x] Existing personal-token tests and cross-user isolation tests remain green.
- [ ] English and PT-BR docs/UI are updated only after deployed client
      interoperability has actually been validated.

## Rollout and rollback

- Schema additions are additive and personal-token data is untouched.
- OAuth defaults disabled and is enabled by an administrator in development.
- Rollback disables `mcp_oauth_enabled`; this stops OAuth authority immediately
  without rotating personal tokens or deleting audit history.
- Grok Web remains marked as manual validation pending until the public
  development deployment completes discovery, login, consent, exchange, and a
  tool call.

## Out of scope

- Replacing Voxen login or configured instance SSO.
- Client Credentials Grant or any client without an owning Voxen user.
- Administrative MCP tools.
- Arbitrary Client ID Metadata URL fetching.
- Device Authorization Grant.
