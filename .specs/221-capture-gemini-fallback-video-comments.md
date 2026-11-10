# Spec 221 — Capture v2: Gemini, provider fallback, local STT, full video and comments

## Context

Spec 220 shipped link capture with four cloud providers (PRs #1034–#1044).
On 2026-11-10 the owner extended it after validating it on the live deploy.
This spec amends spec 220; where they conflict, this spec wins.

Owner decisions (closed):

- G1. Gemini is a fifth provider for text, vision and speech-to-text
  (`gemini-3.5-transcribe` via `@ai-sdk/google`). Its free tier lets Google
  use submitted content for product improvement; the UI must say so.
- G2. Every role (`fast`, `standard`, `vision`, `stt`) has an ordered
  fallback chain of configured providers.
- G3. One optional local model is allowed: a lightweight speech-to-text
  sidecar (`stt-local`, NVIDIA Parakeet TDT 0.6B v3 int8 on ONNX Runtime,
  CC-BY-4.0 weights, Apache-2.0 server) exposing an OpenAI-compatible
  `/v1/audio/transcriptions`. No other local model, no embeddings.
- G4. Videos are always processed fully: when a source has video or audio,
  the speech is transcribed and keyframes are analyzed, even when captions
  or a description exist. Replaces spec 220's "STT only when no usable text
  exists". Captions remain the preferred transcript when they exist (no STT
  is spent then), and descriptions become extra context.
- G5. Comments: the top 50 comments by relevance (likes, then recency) are
  extracted where the platform exposes them without login.

## Spec 220 clauses replaced

D2 (no local inference) → G3; the provider glossary and "fixed endpoints of
the four providers" → five cloud providers plus the keyless `local` STT
endpoint from `STT_LOCAL_URL`; "STT only when no usable text exists" → G4;
the vision gate (text below 1,500 chars) → still applies to thumbnails and
post images, but video keyframes are always analyzed; vision `LLM_AUTH` /
`LLM_QUOTA` failing the job → now a warning; "local models" in out of scope
→ only local text/vision models stay out.

## Requirements

### Providers

- The system shall support provider `google` (Gemini) for text, vision and
  STT through `@ai-sdk/google` provider objects with a fixed base URL. The key
  shall be sent only in the `x-goog-api-key` header, never in a URL; key
  validation is an authenticated models-list call where any 400, 401 or 403
  means invalid (the probe never reads the body); at run time a 400 whose body
  reports `API_KEY_INVALID`, or a 401/403, maps to `LLM_AUTH`; `AIza…` keys are
  redacted like other key shapes. Gemini STT (`gemini-3.5-transcribe`) uses the
  pinned `@ai-sdk/google` transcription model when that version exposes it
  (verified in 4.0.114); otherwise a direct call to the fixed
  `generateContent` endpoint with the audio as inline data, like the
  OpenRouter STT transport. Never through the AI Gateway. Cost comes from
  token usage when reported, else from a per-minute equivalent in the catalog.
- The providers page shall show that Gemini's free tier may use content to
  improve Google products and be reviewed by humans, and that billing-enabled
  keys are not used that way.
- The system shall support a keyless provider kind `local` (STT only) that is
  available only while `STT_LOCAL_URL` is set and the sidecar answers its
  health check; it never appears in the key routes, costs 0, is added to a
  chain only by the user, and stored `local` entries are skipped (not deleted)
  while it is unavailable.

### Fallback chains

- Each role (`fast`, `standard`, `vision`, `stt`) shall store an ordered chain
  of at most 4 unique `{provider, model}` entries under the new user setting
  `ai_model_chains`. The legacy `ai_model_roles` value is read as a one-entry
  chain when `ai_model_chains` is absent and is never rewritten, so a
  downgrade keeps the old assignment.
- Saving the first valid key of a provider shall fill only the chains that
  are empty with that provider's default models; adding a provider to a
  non-empty chain is always an explicit user action (so captured content never
  reaches a new provider, such as a free tier, without the user choosing it).
  A chain never exceeds 4 entries. Removing a key shall remove only that
  provider's entries and keep the order of the rest.
- `GET /api/account/ai` returns `chains`; `PUT /api/account/ai/roles` accepts
  chains (and still accepts the old single-entry shape).
- A call shall try the entries in order. Each entry gets its own per-call
  budget (3 min for a text/vision call; 20 min for the whole audio of one STT
  entry, all chunks included). Any failure of an
  entry (after its own schema retry) moves to the next entry, including
  `LLM_AUTH`, `LLM_QUOTA`, retryable errors, a per-entry timeout, a
  non-retryable `LLM_FAILED` (e.g. a retired model id) and an entry that cannot
  take the input (e.g. images for a non-vision model).
- If the caller's signal is aborted (user cancel, lease loss, step budget),
  then the chain shall stop immediately and no further entry is tried.
- If every entry fails, then the call shall fail with the error of the last
  entry tried. The result records the entry that answered, and the cost of
  every attempt is added to the job cost.
- `standard` and `fast` fall back to each other only when their own chain is
  empty (as in spec 220). Vision never uses a non-vision model and STT never a
  text model.
- An STT fallback restarts the whole audio with the next entry (no mixed
  transcripts).
- The runner step budgets become per-entry budget × chain length.

### Local STT sidecar

- The `stt-local` service shall be built by Voxen from a pinned
  `achetronic/parakeet` source commit (license as stated in its LICENSE file
  at that commit, Apache-2.0 at the time of writing) plus the Parakeet TDT
  0.6B v3 int8 ONNX model verified by checksum, with no ffmpeg and no
  diarization models in the image, run with `-ffmpeg=false` and one worker.
  It decodes WAV only and serves `/v1/audio/transcriptions`.
- The STT audio format is chosen before audio is fetched (for uploads, before
  extraction): when the first available entry of the STT chain is `local` and
  the duration is known and at most 1 h, the worker returns 16 kHz mono PCM WAV
  in chunks of at most 8 minutes (cloud providers accept the same WAV if the
  chain falls back); otherwise MP3 is used and `local` entries are skipped. A
  WAV request the worker cannot honor (unknown duration or over 1 h) returns
  MP3 chunks instead of an error; the chunk `mime` tells the web which format
  it got.
- If the STT chain contains only `local` entries and none is available, then
  the job shall be treated as having no STT chain (`STT_NOT_CONFIGURED` when
  there is no other usable text).
- The sidecar shall run on an `internal: true` network shared only with `web`
  (never with `capture-worker`), with no published ports and no secrets. Any
  5xx, connection error or per-entry timeout is a retryable failure of that
  entry.
- Where the platform cannot create an internal-only network (Easypanel,
  Openship), the sidecar shares the project network: other project services
  (including `capture-worker`) can reach it and it has egress. The isolation
  rule above is guaranteed only under Docker Compose, and the deploy docs
  shall state this residual risk.
- If the sidecar is unreachable, then the `local` entry fails as retryable and
  the chain continues.

### Video, description and comments

- When the worker reports `hasAudio` and an STT chain exists, the system
  shall transcribe the speech unless captions exist.
- The post text or description shall always be kept in the artifact
  (`description`) and passed to interpretation as context; the document shows
  `## Descrição` (post text) and `## Transcrição` (segments) when both exist.
- If transcription fails on every entry, or the audio exceeds 3 h, while other
  usable text exists (at least 200 chars of description, post or page text, as
  in spec 220), then the job shall publish with
  `COMPLETED_WITH_WARNINGS` and a "speech not transcribed" warning; with no
  other usable text the job fails with the STT error (or `STT_NOT_CONFIGURED`
  when no STT chain exists).
- When the worker reports `hasVideo` for a link and a vision chain exists, the
  system shall request up to 4 keyframes from the worker `/v1/frames`
  (smallest stream whose short side is 240–480 px, else the smallest available, ≤300 MB, its own 10-minute budget; evenly spaced
  over the known duration, else at 10/35/60/85% of the file; fewer for videos
  under 4 s) and analyze them together with up to 2 thumbnails/post images
  (at most 6 images per capture). Upload keyframes count as video keyframes
  (always analyzed when a vision chain exists).
- If keyframe extraction or the whole vision chain fails, then the job shall
  publish with `COMPLETED_WITH_WARNINGS` instead of failing.
- The worker shall return up to 50 top-level comments (`author`, `text` ≤1,000
  chars, `likes`, `publishedAt`) for YouTube and Instagram via yt-dlp
  `--write-comments` with bounded extractor args, and for TikTok via its public
  comment-list endpoint through the egress proxy (yt-dlp has no TikTok
  comments; the endpoint is undocumented, so a failure just yields no
  comments), all within their own 60-second budget,
  sorted by likes desc, then `publishedAt` desc, then id, nulls last. A
  comment fetch failure returns `[]` and never fails the capture.
- The document shall include `## Comentários` (most relevant first) and the
  interpretation prompt and schema shall include an `audience` key point when
  comments exist; at most 20,000 chars of comments enter the prompt. Comments
  are untrusted and sanitized like captured text.

## Out of scope

Text-to-speech, local text or vision models, embeddings, logged-in comment
scraping, comment replies, and X comments (no public reply source without
login; X posts return no comments).

## Delivery (one PR each)

1. This spec, CLAUDE.md (local STT exception), ADR-015.
2. Gemini provider and per-role fallback chains (lib/ai + `/conta/ia`).
3. Worker: comments, `hasVideo`, `/v1/frames`, WAV audio format.
4. Local STT sidecar (`stt-local` Compose profile, internal network) and the
   keyless `local` provider, with deploy docs (Compose, Easypanel, Openship).
5. Pipeline: full video (STT + keyframes), description kept, comments in
   documents, warnings; docs (README, ARCHITECTURE, TRANSCRIPT-FORMAT).

## Acceptance

- [ ] A Gemini key validates through the header (no key in any URL) and can
      serve text, vision and STT; an invalid key (400 `API_KEY_INVALID`) is
      refused; the free-tier notice is shown.
- [ ] With chain [anthropic, google] for `standard`, an Anthropic 429, quota,
      auth or retired-model error is answered by Gemini; the document records
      the Gemini model and the job cost includes both attempts.
- [ ] All entries failing returns the last entry's error; a user cancel during
      the first entry tries no second entry.
- [ ] Vision never falls back to a non-vision model; `standard` uses `fast`
      only when its own chain is empty.
- [ ] A legacy `ai_model_roles` value is read as a chain and left unchanged.
- [ ] A TikTok with a description is transcribed when an STT chain exists, and
      its description appears under `## Descrição`.
- [ ] STT failing on every entry with a description present publishes with
      `COMPLETED_WITH_WARNINGS`; with no other text it fails.
- [ ] A YouTube video document contains keyframe descriptions and a
      `## Comentários` section with at most 50 entries in the defined order;
      a comment fetch failure still publishes the document.
- [ ] The `stt-local` sidecar transcribes a PT-BR WAV sample, is used when it
      is the first STT entry, is skipped while unavailable, and cannot be
      reached from `capture-worker`.
- [ ] Removing every STT entry restores `STT_NOT_CONFIGURED` for audio-only
      sources.
