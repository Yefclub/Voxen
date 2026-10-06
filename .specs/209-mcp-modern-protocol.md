# Spec 209 — Modern MCP protocol with legacy compatibility

## Context

The approved MCP audit found that unsupported versions and malformed requests
become HTTP 500 errors, transport instances remain open and newer stateless
protocol requests are unsupported. This increment covers MCP-09/MCP-10,
transport regressions under MCP-02/MCP-08/MCP-16 and the request budget portion
of MCP-06. OAuth, tool contracts and output bounds remain separate increments.

## Requirements

### Ubiquitous

- The system shall use the official maintained MCP v2 server and transport implementation.
- The system shall retain one owner-scoped server per request and existing 2025-era tool contracts.
- The system shall accept protocol revision 2026-07-28 through its per-request metadata and discovery lifecycle.
- The system shall bound request bodies to one MiB before scope inspection or transport parsing.
- The system shall close its server and transport when an exchange finishes, fails or is aborted.
- The system shall enforce a thirty-second exchange deadline and return a bounded timeout response that tells writers to verify current state before retrying.

### Event-driven

- When a legacy client initializes or invokes a tool, the system shall retain JSON response behavior and legacy version negotiation.
- When a modern client discovers or calls the server, the system shall use the official modern response metadata and validate matching version, method and tool-name headers.

### Unwanted behavior

- If a request is malformed or has an unsupported content type, accept header, version or method, then the system shall return a protocol-level 4xx response without exposing implementation failures.
- If a client requests an unsupported standalone GET/DELETE or subscriptions operation, then the system shall reject it without leaving an empty stream open.
- If a request is aborted, then the system shall release transport resources and prevent further response emission.

## Acceptance criteria

- [x] Real v1 and v2 clients can discover/list, search and read owned content through the same endpoint.
- [x] Modern protocol pins and automatic negotiation work while legacy-only clients remain compatible.
- [x] Malformed JSON, wrong Content-Type/Accept, unsupported versions and header/body mismatches return valid bounded errors.
- [x] Oversized bodies return 413 before callbacks execute.
- [x] GET/DELETE and unsupported subscriptions cannot create idle streams.
- [x] Successful, failed and aborted exchanges close per-request resources.
- [x] Tool names, scopes and existing response fields remain compatible.
- [ ] Full checks, real Docker build and independent review pass.

## Decisions and references

Use the official era classification. Legacy responses retain JSON via the v2
Web Standard Streamable HTTP transport; modern exchanges use createMcpHandler.
No authentication sessions, credentials or database schemas change here.

- [Official v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [2026 support and compatibility](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)
- [Streamable HTTP revision](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
