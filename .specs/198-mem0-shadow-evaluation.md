# Spec 198 — Optional Mem0 conversational-memory shadow

## Context

Voxen already owns the canonical user knowledge base: source documents, notes,
grounded evidence, temporal Brain facts, chat history, and durable preference
projections. Replaying all prior conversations is nevertheless an inefficient
way to recover a small number of recurring preferences or project facts.

Mem0 OSS is useful only for testing that narrower conversational-memory problem.
Its memories are model-derived secondary data. They cannot replace Voxen's
sources, evidence ledger, temporal graph, preference controls, or citations.

## Decision

- Add a removable memory-provider boundary with `disabled` as the default.
- Support the current self-hosted Mem0 OSS REST API in shadow mode.
- Write only completed, non-interrupted chat turns.
- Search only from the evaluation harness. Shadow candidates never enter a
  model prompt or a user-visible factual answer.
- Derive a stable opaque Mem0 subject from the authenticated Voxen `userId` and
  a dedicated secret. Callers cannot supply or override the remote subject.
- Pin the scope-secret fingerprint on first use and reject silent secret rotation.
- Preserve conversation/message provenance and an algorithm version in metadata.
- Delete the remote subject before irreversibly deleting a Voxen user.
- Keep Mem0 outside the unified Voxen image and Compose defaults.

## Requirements

### Ubiquitous

- Every add, search, and delete operation shall derive scope from the
  authenticated Voxen user identifier.
- Memory text, API keys, and opaque subject identifiers shall not be logged.
- Retrieved candidates shall be labeled `unverified` and treated as untrusted
  data.
- The adapter shall use the OSS paths without a hosted-platform `/v1` prefix.
- Requests shall be bounded by payload, result, and timeout limits.

### Event-driven

- When a normal chat turn is completely persisted, the shadow adapter may send
  its user and assistant messages to Mem0.
- When a stream is aborted, fails, or pauses for tool approval, no memory shall
  be written.
- When Mem0 is unavailable during a chat, the canonical reply shall remain
  successful and a content-free diagnostic may be emitted.
- When an administrator deletes a user while Mem0 shadow mode is enabled, remote
  deletion shall succeed before canonical user deletion proceeds.
- When account deletion overlaps a shadow write on another application replica,
  a durable per-user fence shall block new writers and drain every registered
  writer before remote deletion, even if the Redis lease is lost.
- When a shadow write has an ambiguous outcome, its durable marker and any
  deletion fence shall remain fail-closed without time-based expiry.

### State-driven

- While `VOXEN_MEMORY_PROVIDER` is absent or `disabled`, no network request shall
  be made.
- While `mem0-shadow` is selected, base URL, API key, and a dedicated scope
  secret shall be required.
- While HTTP is used, an explicit insecure-internal-network opt-in shall be
  required.
- While shadow mode is active, search results shall remain unavailable to the
  chat prompt and Brain index.
- While the provider is disabled, an account with a tracked remote subject shall
  remain undeletable until remote cleanup is explicitly reconciled.

### Optional

- Operators may run the bilingual live evaluation harness against a separate
  self-hosted Mem0 instance.
- A future controlled mode may expose inspect/edit/forget controls only after a
  new decision and measurable evaluation pass.

### Unwanted

- The system shall not send data to Mem0 Platform or any hosted endpoint by
  default.
- The system shall not package Mem0 into the Voxen application image.
- The system shall not use Mem0 Graph Memory as Voxen's knowledge graph.
- The system shall not promote a remembered statement to evidence or a citation.
- The system shall not accept remote `user_id`, `agent_id`, or `run_id` from chat,
  MCP, metadata, or evaluation input.

## Acceptance criteria

- [x] Disabled mode performs no network I/O and changes no canonical behavior.
- [x] Mem0 add/search/delete requests use exact current OSS endpoints and auth.
- [x] User scope is stable, opaque, and isolated across all operations.
- [x] Completed-turn provenance and algorithm version are preserved.
- [x] Failures are soft for chat writes and strict for account deletion.
- [x] Cross-replica deletion fencing survives Redis lease loss and prevents late
      remote data recreation.
- [x] Ambiguous writes never age out automatically or permit account deletion.
- [x] Disabling the provider cannot bypass a tracked subject's remote cleanup.
- [x] Scope-secret identity is pinned and accidental rotation fails closed.
- [x] Search candidates are explicitly unverified and never injected in prompts.
- [x] Configuration rejects unsafe URLs, credentials in URLs, and unbounded values.
- [x] A live evaluation command reports recall, false-memory rate, isolation,
      deletion completeness, latency, and candidate token volume without logging
      conversation content.
- [x] English and Brazilian Portuguese operations documentation records the
      no-go decision for prompt injection until the live thresholds pass.
- [x] Unit, integration-contract, lint, type, quality, migration, and image gates
      pass.

## References

- https://docs.mem0.ai/open-source/features/rest-api
- https://docs.mem0.ai/platform/features/graph-memory
- https://github.com/mem0ai/mem0
- https://arxiv.org/abs/2504.19413
