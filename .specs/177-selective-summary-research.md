# Spec 177 — Selective research after summarization

## Context

The summary must remain grounded only in the transcript. When material context
is missing, an optional second stage may research the web and create the
reviewable enrichment defined by Spec 175.

## Requirements

### Ubiquitous

- The system shall generate `summaryMd` without web tools or external claims.
- The system shall persist an `OFF`, `MANUAL`, or `AUTO` policy, with `OFF` as
  the safe migration default.
- The system shall use a durable idempotent execution keyed by transcript,
  source version, effective configuration, and trigger mode.
- The system shall expose only `openrouter:web_search` to the research stage,
  with bounded calls, results, tokens, duration, and cost telemetry.

### Event-driven

- When `AUTO` mode is active after a summary is persisted, the system shall let
  the model perform zero or more searches for material gaps.
- When `MANUAL` mode receives a web or MCP action, the system shall queue the
  same durable execution used by automatic mode.
- When valid cited output exists, the system shall persist a `SUGGESTED`
  enrichment and never accept it automatically.
- When the model decides not to research, the system shall record the reason
  without creating artificial context.

### State-driven

- While mode is `OFF`, the system shall not perform research calls or incur
  research cost.
- While execution is pending or running, the system shall expose progress,
  trigger, retry, and cancellation without delaying transcript readiness.

### Unwanted behavior

- If research fails, is cancelled, or returns malformed citations, then the
  system shall preserve ingestion and the valid summary without external
  claims.
- If source or web text contains instructions, then the system shall treat them
  as data and prevent any tool except bounded web search.
- If an obsolete execution finishes after cancellation or source-version
  change, then the system shall prevent late persistence.

## Provider contract

The worker uses two phases. A tool-free planner receives the untrusted source
and may propose at most two short public topics. Application code rejects
multi-line, URL, email, high-entropy, oversized, duplicate, or long verbatim
source queries. Each accepted topic is then sent in its own tool-enabled turn;
that turn never receives the title, summary, transcript, or planner rationale.

Tool-enabled turns expose only the beta OpenRouter server tool
`{ "type": "openrouter:web_search" }`. They pin the Exa engine, one hard-capped
tool use, four cumulative results, 2,000 characters per result, and 1,200
output tokens per request. The complete operation has a 90-second wall-clock
deadline and each provider request has a 40-second network timeout. At most two
application-owned search requests are made. Provider routing rejects prices
above USD 1/M prompt tokens, USD 2/M completion tokens, or USD 0.01 per
request; provider-reported cost plus a conservative Exa allowance is also
rejected above USD 0.50.

Every response must contain finite, non-negative token and cost usage. Search
turns must additionally prove exactly one call through
`usage.server_tool_use.web_search_requests`. Evidence is accepted only from
`message.annotations[].url_citation` with safe HTTP(S) URLs. Missing usage,
malformed output, an unexpected tool-call count, or an over-budget response
fails closed and is never persisted as knowledge.

## Rollback and policy transitions

- Switching to `OFF` cancels queued/retry work, requests cancellation of
  running work, and prevents the worker from claiming research.
- Switching from `AUTO` to `MANUAL` cancels automatic work that has not reached
  a terminal state while preserving explicit user/MCP requests.
- Archiving or trashing a transcript makes every nonterminal enrichment
  unclaimable and cancelled. Restoring the transcript never revives that old
  execution; a new explicit or automatic request is required.
- Completed suggestions and accepted context remain inspectable; rollback never
  rewrites the canonical summary. Existing items can be dismissed or deleted
  through the review lifecycle.

## Acceptance criteria

- [x] `OFF`, `MANUAL`, and `AUTO` have persistent, distinct behavior.
- [x] Zero searches is a valid successful result in `AUTO`.
- [x] Valid output creates only a `SUGGESTED` enrichment from Spec 175.
- [x] Automatic and manual triggers share queue, idempotency, and cancellation.
- [x] Failures do not change final ingestion status or a valid summary.
- [x] Cost events distinguish inference, search, result count, and trigger.
- [x] UI, web API, and MCP expose state and regeneration with correct scopes.
- [x] Tests cover zero/multiple decisions, bounds, injection, retry, and
  isolation.

## Out of scope

- Enabling research by default for existing installations.
- Merging external context into the summary.
- Giving write tools to the research model.
