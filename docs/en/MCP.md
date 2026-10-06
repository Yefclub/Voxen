# Connect clients to Voxen through MCP

English | [Português (Brasil)](../MCP.md)

Voxen exposes each approved user's knowledge base through a remote
[Model Context Protocol](https://modelcontextprotocol.io/) server. The endpoint
uses Streamable HTTP and every credential is bound to exactly one Voxen user.

The same endpoint supports protocol revision **2026-07-28** and legacy 2025
clients. Modern clients discover the server and send per-request metadata;
legacy clients keep the `initialize` handshake. Requests must accept both JSON
and SSE, and bodies are limited to 1 MiB. Standalone GET/DELETE session streams
and subscriptions are not exposed; tool calls use POST.

## Connection details

| Field          | Value                                      |
| -------------- | ------------------------------------------ |
| Endpoint       | `https://YOUR-VOXEN-HOST/mcp`              |
| Transport      | Streamable HTTP                            |
| Authentication | Personal Bearer token or OAuth 2.1 + PKCE  |
| Read scope     | Search and read the owner's knowledge base |
| Write scope    | Create/update notes and request ingestion  |

Create a token in **Your account → MCP access**. The secret is displayed only
once. Store it in a password manager or secret environment variable. Never put
it in a URL, commit it, publish it in logs, or paste it into an OAuth client ID
or client-secret field. Revoking it does not sign you out of Voxen.

Use a read-only token first. Enable write access only for a client that needs to
modify your knowledge base and whose approval behavior you understand.

New tokens default to **READ** and expire after **90 days**. Choose WRITE and/or
an intentional non-expiring token explicitly. Existing tokens and OAuth grants
retain their settings. The admin creation action creates an additional token;
revocation is a separate action. Copied agent prompts contain connection guidance
and an environment placeholder, never a bearer secret.

## Execution and result contracts

The catalog contains **44 tools: 31 READ and 13 WRITE**, with required scopes,
explicit effect annotations and validated output schemas. `voxen_get_job_status`
is READ, including jobs submitted by a WRITE-capable client. Server metadata
reports the actual running Voxen version.

Arguments reject unknown fields. Queries are limited to 2,000 characters,
identifiers to 256, arrays to 100 items and nested arguments to 10 levels;
individual tools can impose tighter limits. RPC IDs use strings up to 128
characters or safe integers; RPC methods/tool names are also limited to 128 characters.
JSON-RPC batches are rejected before authentication or execution. Send individual
RPC requests; `voxen_request_transcriptions` still accepts multiple links in one
tool call. This follows the [2025-06-18 MCP change](https://modelcontextprotocol.io/specification/2025-06-18/changelog).
A request has a 30-second deadline from body reading
through authentication and execution. Heavy graph SQL reads have a 3-second
statement budget.

Tool replies are bounded to 96 KiB. Small results retain their normal contract.
Large READ results return `dataChunk` and `_mcp` metadata: `format` is
`application/json`, `offsetUnit` is `utf16`, `resultChecksum` identifies the full
JSON result, and `nextCursor` is the signed continuation. Repeat the same tool and
original arguments with `content_cursor: nextCursor`, concatenate `dataChunk`
values in order and parse JSON only after `nextCursor` becomes null. Each page
rechecks ownership and content lifecycle. Changed content, a different owner/tool/
argument set or an expired cursor requires restarting without `content_cursor`.
A cursor lasts five minutes; each next page receives a fresh expiry. Full read
results above 16 MiB require a smaller page or progressive excerpt.

Large WRITE replies contain a bounded `summary` and `_mcp.followUp` READ
instructions. `toolExecution: completed` describes completion of the tool call;
a queued job still requires monitoring. `applied: false` means a preview did not
apply a write. WRITE tools never accept `content_cursor`. After any uncertain
write, verify current state before retrying.

Note/transcript listing uses signed keyset cursors in `nextCursor`. Order is
creation time descending, then ID descending. Deleting a page boundary or editing
an item does not shift subsequent pages; newly inserted newer items appear when
listing starts again. Keep the original filter unchanged. Old offset cursors are
rejected with restart guidance.

Self-hosted safeguards allow 600 requests/minute per owner, 1,200 per connection
peer and 6,000 globally. They use the observed TCP peer, not caller-controlled
forwarding headers. Execution allows four active tools per owner and sixteen
globally; timed-out callbacks keep capacity until they actually settle. HTTP
429/503 responses include `Retry-After`. Invalid credentials return 401; an
unavailable authentication/protection backend returns 503. Tool failures return
safe codes and a correlation `requestId`, without database/path/credential details.

Operational OAuth auditing retains up to 30 days and the newest 20,000 records,
pruned every minute in bounded batches. Tool diagnostics log names, durations,
outcomes and non-secret identifiers; they do not log arguments, content or bearer
secrets. Configure a valid canonical `APP_BASE_URL` in production. Without one,
MCP fails closed; development only accepts a matching loopback origin/host.

The protocol suite exercises SDK clients 2.3.1 (modern) and 1.32.1 (legacy).
Named product/client-account integrations still require their own real-client
validation. Hosted clients must reach your HTTPS endpoint from their network;
geographic firewall rules also apply to those services.

## Personal and graph context

Read-capable credentials expose `voxen_personal_context`. The tool combines
explicit feedback, activity-inferred interests, trends, and graph-ranked
sources into a bounded, versioned contract. Its `provenance` field separates
`DECLARED`, `INFERRED`, and `MIXED` signals; `stance: LESS` means lower interest
and is never used as a positive recommendation seed.

This context guides discovery and recommendations, but it is not factual
evidence or a psychological profile. Clients must open the returned links,
read the source, and use verification tools before claiming what it says. The
result also reports algorithm versions, the projection watermark, and whether
the graph or context snapshot was truncated. Write-only tokens do not discover
this tool.

`voxen_brain_timeline` retrieves evidence-backed temporal relations. With no
time argument it returns facts valid now, whether their end is unknown or in
the future; `as_of` performs a point-in-time lookup, while `from`/`to` finds
overlapping validity windows. Domain validity (`validFrom`/`validTo`) is kept separate from
`observedAt`, the time represented by the source episode. Missing domain time
stays unknown—it is never inferred from ingestion time. Entity aliases improve
search recall but remain reversible observations; Voxen never merges two
identities merely because their normalized names match.

Temporal relations are extracted knowledge, not proof by themselves. Every
result includes bounded source evidence, and a client must read/verify that
evidence before presenting the relation as factual. Overlapping or conflicting
relations should be shown as uncertainty, not silently collapsed.

## Safe note editing workflow

Note reads return a monotonic `revision` and an opaque `checksum`. Agents should
make bounded changes instead of replacing an entire note whenever possible:

1. Use `voxen_search_notes` to find the note, then
   `voxen_search_note_content` to locate the exact passage and its occurrence.
2. Call `voxen_patch_note` with `preview_only: true`, the observed
   `expected_revision`, and a `replace`, `insert_before`, `insert_after`,
   `prepend`, or `append` operation.
3. Review the bounded preview. Apply by repeating the same call with
   `preview_only: false` only if the revision is still current.
4. Inspect immutable history with `voxen_list_note_revisions` and
   `voxen_read_note_revision`. `voxen_restore_note_revision` creates a new head;
   it never rewrites history.

`voxen_update_note` remains available for compatibility and intentional full
replacements, but it also requires `expected_revision`. A conflict means the
agent must read the current note again and propose a new change; it must never
retry blindly. Read-only credentials cannot discover or execute patch, restore,
create, full-update, or ingestion tools.

Instance administrators can optionally enable OAuth 2.1 in **Administration →
Integrations → MCP Server**. OAuth access is still bound to the Voxen user who
approves the consent screen; it never inherits administrator access.

## Compatibility matrix

“Documented” means the client vendor documents the required transport/auth
surface. It does not mean that every released client version has been manually
tested against Voxen.

| Client                    | Streamable HTTP | Personal Bearer token | OAuth discovery  | Current Voxen status                          |
| ------------------------- | :-------------: | :-------------------: | :--------------: | --------------------------------------------- |
| Codex CLI/app/IDE         |       Yes       |          Yes          |       Yes        | Token and OAuth paths documented              |
| Claude Code               |       Yes       |          Yes          |       Yes        | Static-token setup documented                 |
| OpenAI Responses API      |       Yes       |   Header supported    |   App-managed    | Server-side setup documented                  |
| Anthropic Messages API    |       Yes       |  Authorization token  |   App-managed    | Server-side setup documented                  |
| Cursor                    |       Yes       | Version-dependent UI  |       Yes        | OAuth protocol path available                 |
| MCP Inspector/generic SDK |       Yes       |          Yes          | Client-dependent | Protocol smoke-test path                      |
| Grok Web custom connector |       Yes       |      Not exposed      |     Required     | Protocol ready; manual Web validation pending |

The canonical record of manually tested client versions will live in this
matrix. Do not infer manual validation from a configuration example.

## Codex CLI, app, and IDE extension

Codex reads the same MCP configuration for its CLI, desktop app, and IDE
extension. Put the token in the environment that starts Codex:

```bash
export VOXEN_MCP_TOKEN='paste-the-token-shown-once'
```

Add this to `~/.codex/config.toml` (or a trusted project's
`.codex/config.toml`):

```toml
[mcp_servers.voxen]
url = "https://YOUR-VOXEN-HOST/mcp"
bearer_token_env_var = "VOXEN_MCP_TOKEN"
default_tools_approval_mode = "writes"
```

Restart the Codex surface, then inspect the server with `/mcp`. If the instance
administrator enabled OAuth, omit the Bearer-token setting and use
`codex mcp login voxen`; the browser will ask the Voxen user to sign in and
approve the requested scopes.

## Claude Code

Claude Code supports a remote HTTP server with an explicit authorization
header. Keep the secret out of shell history and shared files: set
`VOXEN_MCP_TOKEN` in the environment and use this entry in `.mcp.json`:

```json
{
  "mcpServers": {
    "voxen": {
      "type": "http",
      "url": "https://YOUR-VOXEN-HOST/mcp",
      "headers": {
        "Authorization": "Bearer ${VOXEN_MCP_TOKEN}"
      }
    }
  }
}
```

Run `claude mcp get voxen` and open `/mcp` inside Claude Code to inspect the
connection. Project-scoped MCP files require workspace trust.

## OpenAI Responses API

Keep the Voxen token on your server. The Responses API remote MCP tool accepts
custom headers:

```json
{
  "type": "mcp",
  "server_label": "voxen",
  "server_url": "https://YOUR-VOXEN-HOST/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_VOXEN_MCP_TOKEN"
  },
  "require_approval": "always"
}
```

Do not send the Voxen token to a browser or mobile client. Your application is
responsible for keeping it secret and deciding which tools require approval.

## Anthropic Messages API

The Anthropic MCP connector accepts a remote URL and an authorization token:

```json
{
  "type": "url",
  "url": "https://YOUR-VOXEN-HOST/mcp",
  "name": "voxen",
  "authorization_token": "YOUR_VOXEN_MCP_TOKEN"
}
```

Pass this object in the request's `mcp_servers` array. Keep the token in your
server-side secret store and follow Anthropic's current MCP beta/version header
requirements.

## Cursor

[Cursor's official guide](https://cursor.com/docs/mcp) documents remote HTTP,
OAuth and environment-variable headers. For OAuth, enable it in Voxen and add:

```json
{ "mcpServers": { "voxen": { "url": "https://YOUR-VOXEN-HOST/mcp" } } }
```

For a personal token, use a secret environment reference in the server entry:
`"headers": {"Authorization": "Bearer ${env:VOXEN_MCP_TOKEN}"}`. Never append a
credential to the URL. Record the installed Cursor version and actual result;
documented configuration does not establish account-level validation.

The MCP transport accepts ordinary Bearer tokens. Sender-constrained tokens,
such as DPoP, are rejected on this interface; configure the client for Bearer.

## OAuth 2.1 discovery and manual clients

OAuth is disabled by default. Once enabled, point discovery-capable clients at
the normal `https://YOUR-VOXEN-HOST/mcp` URL. Voxen publishes:

- Protected-resource metadata: `/.well-known/oauth-protected-resource/mcp`
- Authorization-server metadata: `/.well-known/oauth-authorization-server/api/auth`
- Authorization endpoint: `/api/auth/oauth2/authorize`
- Token endpoint: `/api/auth/oauth2/token`
- Dynamic client registration: `/api/auth/oauth2/register`

Public clients use Authorization Code + PKCE `S256`; the token endpoint auth
method is `none`. Use `mcp:read` by default, add `mcp:write` only when required,
and request `offline_access` for refresh tokens. Access tokens last five
minutes; refresh tokens rotate on every use. Users can revoke a grant under
**Your account → MCP access**. RFC 7009 revocation also invalidates an access
token immediately; Voxen stores only its short-lived random signed identifier.
For confidential clients, RFC 7662 JWT access-token introspection applies the
same live user, grant, client, and individual-token revocation policy as the
MCP endpoint while preserving opaque refresh-token introspection.

If a client requires a manually created client ID, first obtain the client's
exact callback URI and ask an administrator to use **Administration →
Integrations → MCP → Pre-register an OAuth client**. That screen can create a
public PKCE client or a confidential client, and shows a confidential secret
only once. Never guess a redirect URI.

Public clients can also use dynamic registration directly:

```bash
export VOXEN_URL='https://YOUR-VOXEN-HOST'
export CLIENT_REDIRECT_URI='https://EXACT-CALLBACK-SHOWN-BY-THE-CLIENT'
curl --fail-with-body "$VOXEN_URL/api/auth/oauth2/register" \
  -H 'Content-Type: application/json' \
  --data "{\"client_name\":\"My MCP client\",\"redirect_uris\":[\"$CLIENT_REDIRECT_URI\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"],\"scope\":\"mcp:read offline_access\"}"
```

Keep the returned `client_id`; a public PKCE client has no client secret. Voxen
requires exact redirect matching and accepts HTTP only for loopback callbacks.

### Metadata-document clients and loopback callbacks

Voxen supports the MCP 2026-07-28 client metadata profile (CIMD). Clients can
identify themselves with their exact HTTPS metadata-document URL. Discovery
advertises `client_id_metadata_document_supported` and
`authorization_response_iss_parameter_supported`; authorization responses bind
the issuer with `iss`. Documents use a public-address-only DNS-pinned transport
with no redirects and a five-second/128-KiB bound. Credentials remain in the
client and outside prompts. Client discovery still requires explicit user
consent and resource/scopes authorization.

Registered HTTP loopback redirects can vary only their port. The registered
hostname, path and query must still match. All other redirects remain exact.
Existing sessions, client identities, keys and refresh grants are preserved by
the additive Better Auth 1.7.7 migration and canonical resource backfill. Active
MCP credentials also require a current client-resource link and any JWT-bound
session. Metadata-document SDK tests do not establish compatibility with every
installed vendor client; complete account-level client validation separately.

## Grok Web

Grok Web custom connectors require a public HTTPS endpoint and an OAuth flow.
The OAuth form shown by Grok asks for OAuth application credentials and
authorization/token endpoints. A Voxen personal token cannot fill those fields.

Voxen now exposes the standards-based OAuth flow required by hosted clients,
but Grok Web remains marked **manual validation pending** until a public dev
deployment completes sign-in, consent, token exchange, and a real tool call.
Do not paste `vxn_mcp_...` into client ID or client-secret fields. If Grok shows
a manual OAuth form, use a registered public client ID, leave the secret empty,
select PKCE/`none`, and use the endpoints and scopes listed above. If the UI does
not expose its exact callback URI, do not guess it; use automatic discovery or
report that Grok version in [issue #679](https://github.com/Yefclub/Voxen/issues/679).

## MCP Inspector and generic clients

For a generic Streamable HTTP client, send the token in the Authorization
header on every request. A minimal initialize request is:

```bash
curl --fail-with-body https://YOUR-VOXEN-HOST/mcp \
  -H "Authorization: Bearer $VOXEN_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"voxen-smoke-test","version":"1.0.0"}}}'
```

Use MCP Inspector for interactive tool discovery and calls. Select Streamable
HTTP, enter the endpoint, and configure the Authorization header in its auth or
request-header controls. Do not paste the token into a URL query parameter.

A modern discovery smoke test includes the required matching headers and
client-capability metadata:

```bash
curl --fail-with-body https://YOUR-VOXEN-HOST/mcp \
  -H "Authorization: Bearer $VOXEN_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  --data '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"voxen-smoke-test","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Modern `tools/call` requests also require `Mcp-Name` to match `params.name`.
The SDK clients handle metadata, headers and version negotiation automatically.

## Troubleshooting

### `401 Unauthorized`

- Confirm the header is exactly `Authorization: Bearer <token>`.
- Create a new token if the secret was lost; existing secrets cannot be shown.
- Check whether the token expired or was revoked.
- Confirm the owning Voxen account is still approved and enabled.
- OAuth clients should inspect the `WWW-Authenticate` `resource_metadata` URL,
  then restart authorization if the grant or client was revoked.

### `403 Forbidden`

- A browser `Origin` that differs from `APP_BASE_URL` is rejected.
- Confirm that the reverse proxy preserves the public scheme and host and that
  `APP_BASE_URL` is the canonical externally reachable URL.
- An OAuth token that lacks `mcp:write` receives `insufficient_scope` when it
  directly calls a write tool.

### Missing tools or write failures

- `READ` exposes search/read tools; `WRITE` exposes mutation tools.
- A write tool is not registered for a read-only token, so clients normally
  report it as unavailable or not found rather than returning HTTP 403.
- Create a replacement token with both scopes only when writes are required.
- Reconnect the client after changing credentials; tool lists may be cached.

### HTTPS, TLS, and public reachability

- Hosted clients need a publicly reachable HTTPS URL with a valid certificate.
- `localhost`, private addresses, and self-signed certificates are not usable by
  hosted Grok/OpenAI/Anthropic services.
- A tunnel exposes the endpoint but must preserve the canonical
  `APP_BASE_URL`; changing the public URL requires a new OAuth registration.

### Discovery or transport errors

- Use the exact `/mcp` path and Streamable HTTP, not legacy SSE.
- Allow `POST` and the `Authorization`, `Content-Type`, `Accept`, and MCP headers
  through the reverse proxy/WAF.
- Test `/health`, then the curl initialize request above.
- Confirm OAuth is enabled by the instance administrator; discovery remains
  descriptive while authorization and token issuance fail closed when disabled.

## Security checklist

- Prefer read-only, expiring, per-device tokens.
- Revoke credentials immediately after exposure or device loss.
- Never send tokens in issue reports, screenshots, URLs, shell history, or
  client configuration committed to Git.
- Treat MCP-returned content as private workspace data.
- Review write-tool approvals in each client.

## Primary references

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [OpenAI remote MCP tools](https://platform.openai.com/docs/api-reference/responses/create)
- [Anthropic MCP connector](https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector)
- [Cursor MCP](https://docs.cursor.com/context/model-context-protocol)
- [Grok custom connectors](https://docs.x.ai/grok/connectors)
- [MCP debugging and Inspector](https://modelcontextprotocol.io/docs/tools/debugging)

### Research review and edit consistency

Read the research immediately before a review, cancellation or edit. Its response
includes `revision`, `checksum`, and `projection`. Pass that exact snapshot as
`expected_revision` and `expected_checksum` to the MCP write tool. A conflict
requires a fresh read and a deliberate decision; do not retry an unseen overwrite.
REST uses `expectedRevision` and `expectedChecksum` with the same checks.

A successful write commits the canonical research and queues its graph projection
atomically. `projection.state=PENDING` means the graph will synchronize or retry
automatically. Older graph evidence is hidden while pending. Projection errors do
not undo the saved research, and reads never perform repair writes.
