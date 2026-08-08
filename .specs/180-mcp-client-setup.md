# Spec 180 — MCP client setup and compatibility guidance

## Context

Voxen exposes a user-scoped Streamable HTTP MCP server at `/mcp`, but the
account page only creates and revokes personal Bearer tokens. Users cannot see
copyable client configurations, a compatibility matrix, or actionable failure
diagnostics. Grok Web presents OAuth client fields that cannot be satisfied by
the current personal-token authentication, which makes an unsupported flow
look like a documentation problem.

## Requirements

### Ubiquitous

- The repository shall publish equivalent English and Brazilian Portuguese MCP
  guides and link both from the documentation indexes and root README.
- The guide and account page shall identify the canonical endpoint as the
  current public origin plus `/mcp` and the transport as Streamable HTTP.
- Personal tokens shall be described as one-time-visible, user-scoped,
  revocable credentials that must never be placed in URLs or OAuth secret
  fields.
- Examples shall keep secrets in environment variables whenever the client
  supports that pattern.
- Compatibility claims shall distinguish documented capability from a manually
  validated client/version.

### Event-driven

- When a user opens `/conta/mcp`, the page shall show copyable setup for Codex,
  Claude Code, Cursor, a generic Streamable HTTP client, and MCP Inspector.
- When a token has just been created, examples may use that one-time value for
  an explicit copy action; after dismissal they shall revert to a placeholder.
- When the user selects Grok Web, the page and guide shall explain that the
  current personal token is not an OAuth client ID or client secret and that
  OAuth compatibility is tracked separately.
- When a connection fails, the guide shall provide distinct diagnostics for
  401, 403, missing scope, expired/revoked credentials, public HTTPS/TLS,
  reverse-proxy origin, and discovery failures.

### State-driven

- While OAuth support has not passed deployed interoperability validation,
  Grok Web shall remain marked unsupported rather than planned functionality
  being presented as available.
- While a client accepts explicit Bearer headers, its example shall preserve
  the existing personal-token flow without requiring administrator credentials.
- While a client only supports OAuth discovery, the compatibility matrix shall
  not recommend static-token workarounds.

### Unwanted behavior

- If a user copies an example without a newly visible token, then the copied
  text shall contain an unmistakable placeholder instead of an empty secret.
- If documentation languages drift on supported clients or security warnings,
  then an automated contract test shall fail.
- If a sample embeds a real Voxen token shape, then documentation checks shall
  reject it.

## Acceptance criteria

- [x] English and PT-BR guides cover the same clients, matrix, and diagnostics.
- [x] README and both documentation indexes link to the guides.
- [x] `/conta/mcp` exposes endpoint, transport, auth mode, documentation, and
      copyable client-specific configurations.
- [x] Grok Web is explicitly unsupported until OAuth delivery is validated.
- [x] Personal-token handling and revocation guidance is explicit.
- [x] Tests verify localized parity, internal links, placeholder safety, and
      the client setup UI contract.

## Out of scope

- OAuth authorization, discovery, dynamic client registration, and consent.
- Changing current personal-token persistence or tool authorization.
- Claiming manual validation for a client that was only checked against its
  documentation.
