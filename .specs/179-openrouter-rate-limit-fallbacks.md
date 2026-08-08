# Spec 179 — OpenRouter rate limits and model fallbacks

## Context

OpenRouter and an upstream provider can temporarily reject a request with HTTP
429. Voxen currently classifies that response as unexpected in the worker, does
not honor `Retry-After`, and has no administrator-controlled fallback for the
six model purposes. A temporary provider limit can therefore fail ingestion
without trying another compatible model.

## Requirements

### Ubiquitous

- The system shall keep one optional fallback setting for each existing model
  purpose: chat, transcription, web search, vision, document, and X analysis.
- The system shall require a fallback to exist in the configured OpenRouter
  account, support the same modality as its purpose, and differ from the
  effective primary model.
- The system shall preserve the primary model as the first routing choice.
- The system shall never retry account-level authentication, authorization, or
  payment failures in application code. Chat-completion routing shall follow
  OpenRouter's documented `models` contract, which can also choose the fallback
  for model-specific context validation or moderation refusals.
- The system shall never expose OpenRouter response bodies, credentials, or
  provider diagnostics in a user-facing error.
- The system shall attribute cost and model telemetry to the model returned by
  OpenRouter whenever the response identifies it.

### Event-driven

- When an administrator first configures or replaces an OpenRouter key, the
  system shall preserve every compatible fallback and shall select an initial
  compatible alternative for any missing, unavailable, incompatible, or
  primary-equal fallback when the authorized catalog contains one.
- When an administrator changes a primary model, the system shall reject a
  fallback equal to that primary and shall offer a compatible replacement.
- When an administrator selects or clears a fallback, the system shall persist
  that choice independently from the primary model.
- When OpenRouter returns HTTP 429, the worker shall classify it as transient
  and retry after the valid `Retry-After` delay when present, otherwise using
  bounded exponential backoff.
- When a primary chat-completion model fails with an eligible transient error
  and a fallback exists, the system shall route the same request to the
  fallback through OpenRouter's ordered model fallback contract.
- When the transcription endpoint rejects the primary with an eligible
  transient error and a fallback exists, the worker shall retry the request
  with the fallback before exhausting the job retry budget.
- When a fallback produces the response, the worker shall log the purpose,
  primary model, and selected model without logging prompts or credentials.

### State-driven

- While no compatible alternative exists, the system shall keep the fallback
  empty and continue to use the primary model.
- While a fallback is configured, the admin model screen shall show the
  primary and fallback distinctly and allow either to be changed without
  rewriting the other.
- While `Retry-After` is absent, invalid, in the past, or above the configured
  safety bound, the worker shall use a bounded local backoff instead of waiting
  indefinitely.

### Unwanted behavior

- If every retry and fallback attempt is exhausted by rate limiting, then the
  system shall fail the job with a localized, actionable provider-limit
  message and stable error code rather than an unexpected-error message.
- If a key rotation makes a stored fallback invalid, then the system shall not
  persist the new key with that invalid route; it shall replace it with a
  compatible suggestion or leave it empty when none exists.
- If the fallback is the same model as the primary, then the system shall
  reject the configuration instead of presenting it as resilience.

## Provider contract

For `/chat/completions`, Voxen sends the effective primary in `model` and the
configured alternative in OpenRouter's ordered `models` fallback field. This
keeps provider-level retry and model failover inside one request and lets the
response `model` identify the route used. Streaming can only fail over before
the first response bytes, matching OpenRouter's documented behavior.

The audio transcription endpoint is handled in application code because its
fallback contract is not documented as supporting the chat `models` field.
Only 408, 429, 5xx, timeouts, and transport failures are eligible. A valid
numeric or HTTP-date `Retry-After` is bounded to 60 seconds. Permanent 4xx
responses retain their existing setup or validation behavior when Voxen owns
the retry loop. OpenRouter's server-side chat route may select the configured
alternative for the broader documented fallback set; invalid credentials and
insufficient account credit remain failures for the request.

Automatic suggestions use only the authenticated account catalog. Candidates
must pass the existing purpose compatibility predicate and differ from the
primary; non-free models are preferred before catalog order so a resilience
route is not silently tied to shared free-tier limits.

## Acceptance criteria

- [x] HTTP 429 is transient and carries a bounded `Retry-After` hint.
- [x] Exhausted 429 attempts produce a stable, friendly public job failure.
- [x] Every model purpose has an independent optional fallback setting.
- [x] Setup preserves valid fallbacks and suggests replacements when possible.
- [x] Admin API and UI can inspect, select, and clear each fallback.
- [x] Runtime chat-completion requests send ordered primary/fallback routing.
- [x] Audio transcription attempts its configured fallback on transient failure.
- [x] Worker logs and cost events identify the model that actually answered.
- [x] Tests cover 429, `Retry-After`, safe errors, suggestion/persistence,
  incompatible and primary-equal rejection, fallback execution, and no-fallback
  behavior.

## Out of scope

- Changing the OpenRouter account or provider configuration.
- Adding a fallback chain longer than one model per purpose.
- Adding an embedding-model fallback.
- Failing over after a streaming response has already emitted partial content.
- Retrying authentication or payment failures in Voxen application code.
