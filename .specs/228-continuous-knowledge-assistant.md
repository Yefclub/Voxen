# Spec 228 — Continuous knowledge assistant

## Context

The owner authorized an integrated AI assistant, implementation and delivery to
dev on 2026-11-13. This amends spec 215's removal of internal chat; specs 220–227
and deterministic, keyless knowledge-base access remain supported. The owner
explicitly chose to rewind conversation and memory while retaining published
knowledge-base content. Architecture is recorded in ADR-017.

## Requirements

### Ubiquitous

- The system shall provide exactly one persistent conversation per user, with
  server-owned messages, executions and ordered replayable progress.
- The system shall derive ownership from the authenticated approved session
  and enforce it for history, tools, memory, events and mutations.
- The system shall use configured cloud providers and explicit provider objects;
  conversation memory shall remain separate from published knowledge.
- The system shall retain the existing Light/Dark identity, Portuguese/English
  interfaces, desktop navigation and portrait mobile PWA behavior.
- The system shall expose source references, executed actions, model usage and
  actionable errors without exposing credentials or private model reasoning.
- The system shall preserve deterministic knowledge-base features without AI
  credentials, and shall keep capture interpretation separate from agent tools.

### Event-driven

- When a user sends a message, the system shall persist it before execution,
  deduplicate retries by request key and allow at most one active execution in
  that conversation.
- When a browser disconnects, the system shall continue server execution and
  allow reconnecting clients to recover persisted progress and output.
- When a user stops execution, the system shall persist cancellation and partial
  output and fence subsequent writes from that execution.
- When an execution loses its lease or the server restarts, the system shall
  recover its observable state without replaying completed write effects.
- When a user edits an earlier user message, the system shall replace that
  message, discard its continuation and affected memory, and generate a new
  continuation from the valid prefix.
- When a user removes the continuation after a message, the system shall keep
  the chosen prefix and invalidate later executions, events and derived memory.
- When the conversation is rewound, the system shall retain already published
  documents, notes and their action receipts, and shall prevent discarded
  conversation text from reappearing through conversation-memory retrieval.
- When the assistant searches, the system shall offer owner-scoped search,
  outlines, bounded passage reading, related content and citation verification.
- When reading a long note, the system shall return bounded continuation
  windows tied to its revision and reject a continuation from a stale revision.
- When a user clearly requests an addition in natural language, the system shall
  infer the requested capability from that user's request, execute bounded,
  idempotent URL capture or note creation through existing domain services and
  present the resulting document, note or job reference.
- When addition intent or its target is ambiguous, the system shall show the
  exact proposed addition in the conversation and require that user's explicit
  confirmation before executing it.
- When a user confirms or dismisses a proposed addition, the system shall
  validate its owner and conversation revision and persist the decision.
- When an addition publishes a note or enqueues a capture, the system shall
  commit that publication and its durable assistant receipt atomically;
  graph synchronization and notifications shall run after the commit.
- When a user includes files, the system shall submit them through the existing
  capture upload contract and expose their resulting owned references to chat.
- When context reaches its configured limit, the system shall compact older
  turns into structured, source-linked memory, retain recent turns verbatim and
  make retained older conversation passages available on demand.

### State-driven

- While an execution is active, another tab shall observe its state and shall
  receive a conflict rather than start a competing execution.
- While composing messages, the interface shall not require selecting a mode
  or enabling a permission toggle; clear requests and contextual confirmations
  shall determine addition intent.
- While a nonblank draft exists or the phone keyboard is open, starter
  suggestions shall be unavailable and shall not replace the draft.
- While compacting, the system shall keep objectives, explicit decisions,
  constraints, identifiers, pending work and uncertainty distinct; authorization
  shall remain server state and shall never be inferred from a summary.
- While displaying long history, the interface shall page older messages and
  preserve reading position rather than rendering an unbounded initial history.
- While operating on a phone, the composer shall remain reachable above the
  keyboard and contextual editing/settings shall use mobile sheets.

### Optional

- Where web research is configured, the system shall offer bounded discovery
  and page retrieval, retain source URLs and retrieval dates and identify web
  evidence separately from library evidence.
- Where web research is unavailable, the assistant shall retain knowledge-base
  tools and explain that external research is unavailable.

### Unwanted behavior

- If an obsolete execution, tool result, compaction or event arrives, then the
  system shall reject its attempt to modify the new conversation revision.
- If an untrusted document or page requests a tool action, then the system shall
  retain permissions inferred independently from user-authored requests or
  persisted explicit confirmations, and shall enforce action limits.
- If a provider fails after emitting output or executing an action, then the
  system shall preserve the result and require an explicit new continuation
  rather than silently replaying the turn on another model.
- If no usable text provider exists, then the interface shall explain how to
  configure one and shall retain all existing conversation and library data.

## Acceptance criteria

- [x] Single-session persistence, pagination, retries and cross-user isolation.
- [x] Persisted streaming, reconnect, stop, restart recovery and two-tab conflict.
- [x] Editing and pruning remove future text and derived memory, including late
  events, while preserving previously published knowledge and receipts.
- [x] Multi-step knowledge tools return usable owned passages and references.
- [x] Capture and note additions are bounded and idempotent across retries.
- [x] Publication and receipt fault injection proves atomic rollback and
  post-commit recovery of the single publication and its visible reference.
- [x] Long-note continuation reaches later passages, preserves Unicode
  boundaries and rejects absent or stale continuation revisions.
- [x] Clear requests execute without a mode; ambiguous additions require exact,
  revision-bound confirmation; retrieved instructions cannot grant permissions.
- [x] Attachments use existing capture limits and storage ownership.
- [x] Repeated compaction preserves critical facts and supports older-history
  retrieval; editing before a compacted range removes its future facts.
- [x] Desktop/mobile, Light/Dark, keyboard, edit, prune, stop and errors are
  verified in the browser with recorded evidence.
- [x] Existing tests, repository gates, independent review and dev deployment pass.

Delivery evidence for PR #1088: 1,514 application tests, 125 automation tests,
additional SSE and web contracts, Chromium workflows and WebKit
keyboard/confirmation regressions. Independent technical and visual reviews
passed, and the final head passed every remote check. Development build
`0.15.1-dev.1794597823` (`af57f318`) was deployed with both forward migrations
applied. Live health checks and the four desktop/phone Light/Dark composer and
preferences states passed without browser errors. Keyboard viewport behavior
is emulated; physical OS behavior is not claimed.

A subsequent live-provider intent check found false negatives for explicit
Portuguese and English note requests that include a title and body. The prompt
correction distinguishes classification from executing embedded instructions,
while retaining exact user evidence, conservative ambiguity handling and
existing publication fences. Live semantic evaluation is separate from mocked
SDK contract tests; a green mock suite does not establish intent accuracy. Eight
live-provider cases passed after the correction: direct note/capture requests
in both locales, negation, a how-to question, a quoted command and ambiguous
interest. This is a bounded regression sample, not a general accuracy claim.

## Out of scope

Multiple sessions, public chat sharing, billing, local text inference, embeddings,
arbitrary shell execution and changing existing public MCP contracts. General
execution sandboxes and additional search engines require a separately validated
need; controlled web tools do not require arbitrary code execution.

> 2026-11-13: The owner rejected the initial composer and its permission mode.
> Use a text-first modern composer, a centered empty state, a simple upward
> send arrow and natural-language intent with contextual confirmation.


## Chat presentation refinement — 2026-11-13

The owner selected Orbital's composer, conversation hierarchy and live activity
as a reference, while retaining Voxen's identity and single conversation.
Reference source: Orbital main `ff9de896a5293c5de78233314c3e580a6893f396`.
It is a behavioral/visual reference; its private, unlicensed source is not vendored.
The owner chose one compact, expandable progress line.

- The chat workspace shall retain an accessible page heading without repeating
  the visible destination title already supplied by desktop navigation.
- The preferences action shall occupy the upper trailing workspace corner,
  independently of the centered reading column, with a reachable touch target.
- While the draft is empty or one line, the composer shall use a single compact
  row for attachment, input and send (at most 72 CSS pixels high at 390px and
  1280px widths); longer drafts shall grow within a bounded scrolling editor.
- While streaming, the interface shall expose one compact progress disclosure
  with localized tool details, partial answer text, stop and reconnect behavior.
- Conversation content shall lead the hierarchy; edit/rewind controls, sources
  and model usage shall remain discoverable without competing with the answer.
- Streaming feedback shall respect reduced motion, preserve the mounted input,
  retain failed drafts and keep the user's scrolled-up reading position.

Acceptance: rendered desktop/phone Light/Dark geometry; long-draft growth and
shrinkage; corner preferences; real persisted streaming and expandable activity;
stop, reconnect, navigation, failed drafts and publication-preserving rewind.
