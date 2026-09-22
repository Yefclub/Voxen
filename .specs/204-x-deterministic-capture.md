# Spec 204 — Deterministic capture and access verdict for X posts

## Context

`ANALYZE_X` retrieves X posts exclusively through a model-native web/X search
on OpenRouter. The prompt instructs the model to state when the post is not
accessible instead of inventing details, and the pipeline's only content guard
rejects an empty answer. A model answer narrating the failure is therefore
non-empty, gets persisted as canonical content, and the job completes; the
summary generated from it describes the failure instead of the post.

This happened to a public post whose full text, author, date, metrics, and
media were available from X's public syndication endpoint without
authentication. The failure was silent: no job failed, no refresh path exists
for X, and regenerating the summary re-reads the same broken text.

Spec 201 already requires that public deterministic metadata may be used as a
safe fallback when the enriched analysis is unavailable. This spec defines the
deterministic capture path and an explicit access verdict for X ingestion.

## Glossary

- **Deterministic capture**: public post content obtained from the syndication
  endpoint, without a model.
- **Enriched analysis**: model-generated markdown grounded on the capture or on
  native search.
- **Access verdict**: structured first line that declares whether the model
  retrieved the post.
- **Capture-only content**: canonical content persisted from the capture when
  the enriched analysis is unavailable.

## Requirements

### Ubiquitous

- The system shall attempt deterministic capture of the public X post before
  relying on native search.
- The system shall ground the enriched analysis on the captured content
  whenever a capture succeeds.
- The system shall persist capture-only content when the enriched analysis
  fails after its retries.
- The system shall keep the `X_SEARCH` transcription method and the X markdown
  contract unchanged.
- The system shall accept capture media URLs only over HTTPS on X media
  domains.
- The system shall emit safe diagnostics for capture failure, capture fallback,
  and missing access verdict.

### Event-driven

- When the model answer to a native-search request declares the post
  inaccessible, the system shall fail the job with an actionable public message
  instead of persisting the answer.
- When the model answer omits the access verdict, the system shall treat
  explicit retrieval-failure wording in the opening of the answer as
  inaccessible.
- When a capture succeeds and the enriched analysis fails, the system shall
  persist the capture and keep summary and tagging enrichment running.
- When the capture provides author, publication date, or preview media, the
  system shall use them as transcript metadata.

### State-driven

- While a capture is available, the system shall not request native X search.
- While a capture is unavailable, the system shall keep the native-search path
  with the same model and fallback configuration.

### Unwanted behavior

- If the captured payload is absent, empty, or does not identify the requested
  post, then the system shall treat the capture as unavailable.
- If the capture request times out or returns an unexpected payload, then the
  system shall continue with the native-search path without failing the job.
- If neither the capture nor the model retrieves the post, then the system
  shall fail the job with a retryable, user-facing message.
- If the access verdict is unparseable and the answer does not contain explicit
  retrieval-failure wording, then the system shall keep the answer.

## Acceptance criteria

- [ ] A post with an available syndication payload is analyzed with the
      captured content, and native search is not requested in that call.
- [ ] A model answer declaring the post inaccessible fails the job with code
      `X_CONTENT_UNAVAILABLE`.
- [ ] A model answer without the verdict that explicitly says it could not
      retrieve the post is rejected the same way.
- [ ] A model answer with an `OK` verdict is persisted without the verdict
      line.
- [ ] A capture that succeeds while the model call fails permanently persists
      the capture instead of failing the job.
- [ ] Captured author, date, and preview image populate transcript metadata.
- [ ] A capture failure leaves the current native-search behavior unchanged.
- [ ] Unit tests cover payload parsing, media extraction, markdown rendering,
      verdict parsing, and the content selection branch.

## Out of scope

- X API credentials, paid endpoints, or authenticated scraping.
- New transcription methods or Prisma schema changes.
- Changes to the chat `search_x` tool.
- Backfilling previously ingested failure narratives (covered by the
  transcript reprocess spec).

## Risks / open decisions

- The syndication endpoint is undocumented. Capture is always best-effort and
  the model path remains the fallback if the endpoint changes or is blocked.
- The verdict depends on prompt compliance; the wording heuristic only covers
  explicit retrieval-failure statements and deliberately does not classify
  generic caveats.
</content>
</invoke>
