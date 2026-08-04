# Spec 156 — Workspace, personal account, and administration boundaries

## Context

The application currently renders workspace destinations, personal credentials,
and instance administration as one flat navigation list. This makes an admin's
personal account look like platform configuration and exposes the legacy
`/setup` name after onboarding. Personal MCP tokens are already isolated by
session in the API, but users have no interface to manage them.

## Glossary

- **Workspace**: day-to-day knowledge work owned or consumed by the signed-in
  user, such as chat, sources, notes, automations, artifacts, and graph.
- **Personal account**: identity, platform sessions, preferences, and API
  credentials owned by the signed-in user.
- **Administration**: instance-wide policy, AI models, infrastructure,
  integrations, users, and costs; available only to administrators.

## Requirements

### Ubiquitous

- The system shall present workspace, personal account, and administration as
  distinct navigation domains.
- The system shall keep all model selection and instance configuration inside
  the administration domain.
- The system shall derive ownership of personal MCP tokens exclusively from the
  authenticated session.
- The system shall never expose an existing MCP bearer secret after creation.
- The system shall keep the administration destination hidden from non-admins.

### Event-driven

- When an administrator opens `/admin`, the system shall present an
  administration shell with configuration, integrations, users, and costs.
- When a legacy `/setup` URL is opened, the system shall redirect to
  `/admin/configuracao` while preserving its query string and hash.
- When a user creates a personal MCP token, the system shall show the bearer
  secret once and clearly instruct the user to store it.
- When a user revokes a personal MCP token, the system shall affect only a token
  owned by that session.

### State-driven

- While user-managed MCP tokens are disabled by instance policy, a non-admin
  shall still see existing token metadata and revoke controls, but shall not be
  offered a misleading create action.
- While the signed-in user is an admin, the normal product and personal areas
  shall remain available without presenting their controls as instance
  configuration.

### Unwanted behavior

- If a non-admin enters an `/admin` URL, the client shall redirect before
  mounting administrative content and the server APIs shall continue to deny
  access independently.
- If a token belongs to another user, list and revoke operations shall not
  reveal or mutate it.
- If navigation is collapsed or rendered on mobile, domain separation shall not
  be lost through duplicate flat menu entries.

## Acceptance criteria

- [x] Expanded desktop and mobile drawer navigation visibly group workspace,
      personal account, and administration.
- [x] The collapsed rail and mobile profile menu expose one administration
      entry instead of mixing every admin page with personal destinations.
- [x] `/admin/configuracao` replaces `/setup` as the canonical configuration
      route; the legacy route redirects with search/hash preserved.
- [x] Every admin page is reachable through a shared admin sub-navigation.
- [x] `/conta/mcp` lists, creates, copies once, and revokes only the current
      user's tokens while respecting the admin-controlled issuance policy.
- [x] Navigation/route contracts and personal MCP API isolation are covered by
      automated tests.
- [x] Typecheck, lint, relevant tests, production build, and browser validation
      pass.

## Out of scope

- OIDC/SSO authentication providers.
- The optional canvas-focused visual mode and its per-user preference.
- Changing AI model defaults or worker behavior already delivered by specs 152
  and 153.

> 2026-08-03: scope approved by the owner as part of the product improvement
> study.
