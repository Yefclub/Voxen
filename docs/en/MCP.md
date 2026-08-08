# Connect clients to Voxen through MCP

English | [Português (Brasil)](../MCP.md)

Voxen exposes each approved user's knowledge base through a remote
[Model Context Protocol](https://modelcontextprotocol.io/) server. The endpoint
uses Streamable HTTP and every credential is bound to exactly one Voxen user.

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

Cursor documents remote Streamable HTTP and OAuth. Its static custom-header
surface has changed between versions, so Voxen does not publish a token-bearing
`mcp.json` snippet as universally compatible. If your installed Cursor version
explicitly supports a secret Authorization header for remote MCP, use the
endpoint and Bearer value above. Never append the token to the URL.

Otherwise use Cursor's normal OAuth flow after the instance administrator
enables OAuth. Record the Cursor version and result when reporting compatibility.

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
