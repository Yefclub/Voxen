# Mem0 OSS shadow evaluation

Português (Brasil): [`../MEM0-SHADOW.md`](../MEM0-SHADOW.md)

## Status and decision

Mem0 is **experimental, optional, self-hosted, and disabled by default**. The
current decision is **no-go for prompt injection**. Voxen may send completed chat
turns to an isolated Mem0 OSS server and evaluate search results, but those
results never enter the internal agent prompt, Brain, MCP, citations, or the
canonical knowledge base.

This boundary is deliberate:

- Voxen owns source documents, notes, evidence, temporal facts, user-controlled
  preferences, and the queryable knowledge graph.
- Mem0 produces inferred conversational memories. They are useful retrieval
  candidates, not verified facts.
- Mem0 Platform Graph Memory currently improves ranking through untyped entity
  co-occurrence and does not expose typed relations. It is not a replacement for
  Voxen's evidence-backed temporal graph.

## What the experiment tests

The adapter targets recurring preferences, projects, people, and terminology
across chat sessions. It uses the current self-hosted OSS endpoints:

- `POST /memories` to process one completed user/assistant turn;
- `POST /search` with `explain: true` for the evaluation harness only;
- `DELETE /memories?user_id=...` before a Voxen account is deleted.

There is no `/v1` prefix. `X-API-Key` authentication is required. Voxen derives a
stable opaque remote subject with HMAC from the authenticated Voxen user ID;
chat, MCP, metadata, and evaluation cases cannot override that subject.

## Run Mem0 separately

Mem0 is intentionally not bundled into the Voxen image or default Compose stack.
Deploy the official OSS server on a private network and finish its authentication
setup. Follow the [official self-hosted REST server guide](https://docs.mem0.ai/open-source/features/rest-api).

Set these variables on the Voxen `web` service:

```dotenv
VOXEN_MEMORY_PROVIDER=mem0-shadow
MEM0_BASE_URL=https://mem0.internal.example
MEM0_API_KEY=m0sk_replace_with_a_dedicated_admin_key
MEM0_SCOPE_SECRET=replace_with_at_least_32_random_characters
MEM0_DEPLOYMENT_VERSION=mem0-api-server@sha256:replace_with_pinned_digest
MEM0_EXTRACTION_MODEL=provider/model-configured-in-mem0
MEM0_RETENTION_DAYS=30
MEM0_REQUEST_TIMEOUT_MS=5000
```

For plain HTTP on an isolated Docker network, explicit acknowledgement is
required:

```dotenv
MEM0_BASE_URL=http://mem0:8000
MEM0_ALLOW_INSECURE_HTTP=true
```

Never expose an HTTP Mem0 endpoint outside that private network. Keep Mem0 auth
enabled. Use a dedicated API key created by a Mem0 administrator: the current
OSS bulk-delete endpoint requires the authenticated owner to have the admin
role. Do not reuse that key in browsers or other applications.

Pin the Mem0 image by digest and record that digest plus the exact extraction
model in the two provenance variables. Shadow memories expire after 30 days by
default; the supported retention range is 1–365 days.

## Live evaluation

After configuration, run:

```bash
pnpm memory:eval
```

Optionally include the model/embedding spend observed in Mem0 for this run:

```bash
MEM0_EVAL_COST_USD=0.012 pnpm memory:eval
```

The command uses disposable opaque subjects, deletes them at the end, prints no
conversation content, and returns a machine-readable report with:

- provenance recall, expected-content accuracy, contradiction rate, and precision;
- false-memory and cross-user-leak rates;
- deletion residues;
- p50/p95 search latency;
- candidate-token volume versus full replay;
- operator-reported cost.

It exits non-zero unless recall and precision are at least 0.80, false-memory
rate is at most 0.10, cross-user leaks and deletion residues are zero, and p95
search latency is at most 1.5 seconds; contradiction rate must remain at most
0.05. Passing makes the experiment only
**eligible for controlled review**. It does not enable prompt injection.

The feature-off baseline measures the incremental memory layer (zero external
latency and candidate tokens). Canonical Voxen retrieval remains enabled in both
states and must be evaluated separately before any future controlled mode.

## Failure, deletion, and rollback

- Chat writes are best-effort. A Mem0 outage cannot fail a canonical reply.
- Aborted, failed, and tool-approval-paused turns are not written.
- Account deletion is strict: if enabled Mem0 cannot delete the remote subject,
  Voxen keeps the canonical account instead of orphaning derived personal data.
- Set `VOXEN_MEMORY_PROVIDER=disabled` (or remove it) to stop all network calls.
  No database migration or canonical-data rollback is required.
- Removing Mem0 storage does not remove transcripts, notes, Brain facts, chat
  history, or user-controlled preferences from Voxen.

## Before any future promotion

A separate specification and review must add user inspection, edit, forget, and
export controls; retention and disabled-account policies; audit metrics; an
administrator kill switch; and adversarial grounded-answer evaluation. Until
then every Mem0 candidate remains unverified and unreachable by the model.
