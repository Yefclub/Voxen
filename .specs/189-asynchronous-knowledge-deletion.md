# Spec 189 — Asynchronous knowledge deletion

## Context

Knowledge deletion currently executes storage, relational, and graph cleanup in
the HTTP request that initiated it. Large transcripts, note trees, and graph
materializations can therefore keep a page waiting, time out behind a reverse
proxy, or leave callers unsure whether an irreversible operation completed.

Voxen also needs a safe way for its internal agent and MCP clients to request
deletion without giving model output an unreviewed destructive path. Deletion
must become a durable, observable, user-scoped job whose database and storage
steps can be retried without corrupting the knowledge graph.

## Glossary

- **Deletion request**: durable job that identifies one user-owned knowledge
  resource and records its progress.
- **Target**: transcript, note or note tree, saved media, library folder tree, or
  transcript enrichment selected for deletion.
- **Destructive confirmation**: explicit human approval in chat, or an exact
  title plus confirmation flag in MCP.
- **Tombstone state**: an existing lifecycle state that prevents a target from
  being treated as active while deletion is pending, where the resource model
  supports one.

## Requirements

### Ubiquitous

- The system shall execute storage deletion, relational cleanup, derived-data
  cleanup, and graph invalidation outside the initiating HTTP or MCP request.
- Every deletion request, target lookup, worker mutation, progress event, retry,
  and graph invalidation shall be scoped to the authenticated user.
- Every deletion request shall be durable in Postgres and discoverable through
  the existing job queue and job detail interfaces.
- Every deletion handler shall be idempotent so a lost worker lease or repeated
  notification cannot delete another target or corrupt graph state.
- Deleting automatic graph evidence shall preserve unrelated manual graph
  evidence and materializations owned by other knowledge sources.
- Internal-agent deletion shall always require per-operation human approval and
  shall never be eligible for an always-allow preference.
- MCP deletion shall require write scope, an explicit confirmation flag, the
  target identifier, target type, and exact current target title.

### Event-driven

- When the browser requests deletion of a supported target, the system shall
  validate ownership, enqueue or return the existing active deletion request,
  and respond with HTTP 202 without waiting for storage or graph cleanup.
- When the internal agent proposes deletion, the system shall resolve the
  canonical title and type from current user-scoped state before displaying the
  approval prompt.
- When a person approves an internal-agent deletion, the system shall atomically
  consume the approval and create or reuse the corresponding deletion job.
- When an MCP client requests deletion, the system shall compare the supplied
  exact title with current user-scoped state before enqueueing the job.
- When a deletion worker claims a request, the system shall publish bounded,
  persistent progress for preparation, storage cleanup, database cleanup, graph
  cleanup, and completion.
- When transcript deletion completes, the system shall preserve a separately
  saved original-media record according to the current saved-media lifecycle.
- When a target is already absent, a retry of its existing deletion job shall
  complete successfully after removing any remaining source-scoped graph
  evidence.
- When graph cleanup completes, the system shall invalidate the user's graph
  snapshot so open pages can fetch current state.

### State-driven

- While a deletion request is queued, duplicate requests for the same user,
  target type, and target identifier shall reuse the active request.
- While a deletion request is running, the system shall reject cancellation
  because an external storage mutation may already be irreversible.
- While a transcript awaits permanent deletion, it shall remain in trash and
  excluded from active retrieval.
- While saved media awaits deletion, it shall remain in its deleting lifecycle
  state and shall not be processable.
- While a credential lacks MCP write scope, the deletion tool shall not be
  registered or executable.

### Unwanted behavior

- If a target belongs to another user, then the system shall hide its existence
  and create no job, progress event, storage mutation, or graph mutation.
- If the requested target type, identifier, confirmation flag, or expected title
  is invalid, then the system shall create no deletion request.
- If an internal-agent approval is stale because the target disappeared or its
  canonical title changed, then the system shall reject the approval without
  deleting anything.
- If storage deletion fails, then the system shall retain a failed, retryable job
  and shall not falsely report completion.
- If a worker loses its lease, then stale work shall not mark the request done or
  publish authoritative completion.
- If a deletion request targets an active saved-media download or transcription,
  then the system shall reject it until that processing is terminal.
- If a note-folder or library-folder target contains descendants, then the
  system shall delete only descendants belonging to the same user and clean all
  corresponding source-scoped graph evidence.

## Acceptance criteria

- [x] An idempotent migration adds the deletion job type and target metadata.
- [x] Browser transcript, note, saved-media, library-folder, and enrichment
      deletion endpoints return 202 with a job identifier and never perform
      storage or graph cleanup inline.
- [x] Duplicate active deletion requests reuse one user-scoped job.
- [x] Transcript hard deletion is rejected unless the transcript is already and
      still in trash, for browser, internal chat, MCP, and worker execution.
- [x] The worker deletes each supported target idempotently, publishes durable
      stages, respects lease fencing, and invalidates the graph cache.
- [x] Transcript deletion serializes against source refresh, and recursive folder
      deletion rejects cross-workspace descendants before any cascade.
- [x] Internal chat can propose every supported knowledge deletion only through a
      server-validated, non-always-allow HITL approval.
- [x] MCP exposes one destructive write-scoped deletion tool with exact-title
      confirmation and user isolation.
- [x] The queue and job detail pages label deletion jobs and their stages in
      Brazilian Portuguese and English.
- [x] Existing browser flows explain that deletion was queued instead of
      claiming that it already finished.
- [x] Unit and integration tests cover ownership, duplicate requests, stale
      confirmation, active-processing rejection, retries, and graph cleanup.
- [x] Migration replay, lint, typecheck, full tests, and production builds pass.

## Out of scope

- Deleting user accounts, authentication providers, integrations, automation
  definitions, chat history, or administrative configuration.
- A timed recycle bin or undelete after a permanent deletion job starts.
- Bulk deletion of arbitrary mixed targets in one job.
- Allowing destructive chat operations through always-allow.

## Rollout and rollback

- Existing synchronous endpoints keep their URLs but change successful deletion
  responses to HTTP 202 with a job identifier.
- Existing personal MCP tokens remain valid; only credentials with write scope
  receive the new tool.
- Rolling back the application may leave queued deletion jobs unknown to an old
  worker. Their target data remains intact until a compatible worker processes
  them; the additive schema must not be dropped during rollback.

> 2026-08-10: approved from the owner's explicit request to expose safe deletion
> through internal AI and MCP and to move knowledge/graph removal into the
> durable background queue.
