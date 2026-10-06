# Spec 210 — Safe MCP credentials, tool contracts and execution

## Context

The owner approved the complete MCP audit backlog. Protocol and knowledge
correctness are delivered separately. This increment covers MCP-01/02/06/07,
MCP-13/14/17/18/19/20/21/22/23/25 and associated MCP-08 regressions: credential
exposure, least privilege, bounded safe tool results, stable pagination,
request protection, truthful contracts, diagnostics and connection guidance.
OAuth schema/CIMD migration and enrichment write concurrency remain separate.

## Requirements

### Ubiquitous
- The system shall exclude bearer secrets and token hashes from generated agent prompts and public token metadata.
- The system shall use one tool policy catalog for required scope, effects and validated input/output contracts.
- The system shall bound tool arguments and result bytes, mark truncation explicitly and provide deterministic read continuation.
- The system shall return safe tool errors with a public code and correlation identifier rather than internal database, path or credential details.
- The system shall advertise the actual running build version.
- The system shall emit tool-level duration, outcome, tool name and non-secret identity/correlation fields without recording arguments, content or bearer tokens.
- The system shall enforce current account, consent and revocation state on every authenticated request.

### Event-driven
- When a client requests a read operation with insufficient scope, the system shall challenge for READ; when it requests a write operation, the system shall challenge for WRITE.
- When a user creates a token, the system shall default to READ with an explicit configurable expiration while preserving existing tokens and intentional non-expiring choices.
- When a client requests job status, the system shall classify the operation as read-only and make it available to READ credentials.
- When pages change between requests, the system shall use validated stable keyset cursors and deterministic ordering.
- When operational audit retention expires, the system shall prune records within bounded maintenance work.

### State-driven
- While clients exceed conservative request/concurrency safeguards, the system shall return a retryable response and release capacity after execution.
- While a valid token is used repeatedly, the system shall throttle last-used telemetry updates without caching authorization decisions.

### Unwanted behavior
- If origin/host configuration is absent or invalid, then the system shall use a safe localhost development boundary or fail closed.
- If an authentication or protection backend fails, then the system shall return a bounded unavailable response distinct from invalid credentials.
- If a cursor, query, identifier or tool result exceeds its contract, then the system shall reject or paginate it without exposing raw implementation failures.

## Acceptance criteria
- [ ] Personal/admin metadata and prompt APIs never expose token hashes or raw secrets.
- [ ] Generated configurations/prompts use credential environment placeholders and current OAuth guidance.
- [ ] READ job monitoring, bidirectional scope challenges and safe token defaults behave consistently.
- [ ] Argument/result bounds, exact continuation and safe failure codes are covered by regressions.
- [ ] Every tool has truthful annotations and a validated output contract derived from the catalog.
- [ ] Pagination survives inserts, edits, deletion and equal timestamps without duplicates or invalid offset conversion.
- [ ] Rate/concurrency safeguards and telemetry throttling preserve immediate revocation and recover from backend failures.
- [ ] Logs contain safe tool outcomes/correlation and bounded audit retention is verified.
- [ ] Canonical origins/hosts, localhost variants and build identity are validated.
- [ ] Transport/auth/catalog/domain registration responsibilities are split into bounded modules.
- [ ] English/PT-BR guides and UI are consistent with the implemented contracts.
- [ ] UI interactions and themes are verified in isolated Playwright before/after captures.
- [ ] Full checks, actual runtime build and independent review pass without weakening gates.

## Decisions

Apply moderate self-hosted safeguards to accidental loops rather than commercial
quotas. Preserve credential secrets, stored user content, OAuth grants and local
storage. Read continuation must be explicit and verifiable; write results must
never encourage blindly repeating uncertain writes.

Large read results retain the normal result when it fits the wire budget. Larger
results use explicitly labeled JSON text fragments and a signed `content_cursor`,
bound to owner, tool, original arguments and the current result checksum. Each
continuation re-runs the read authorization/lifecycle checks; changes invalidate
the continuation. No content cache is introduced. Oversized write replies provide
bounded outcome identifiers and follow-up READ instructions rather than a write
continuation. Normal tool result contracts include these explicit alternatives.
