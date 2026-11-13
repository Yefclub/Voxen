# Continuous knowledge assistant

Open **Chat** (`/chat`) after configuring a text provider under
**Account → AI providers**. The assistant uses the existing standard or fast
model role and its ordered provider chain. The rest of the library and MCP
remain usable without provider credentials.

## Conversation and library actions

Each user has one retained conversation. Questions, answers and progress are
stored in PostgreSQL; closing the tab does not cancel a running answer. Reopen
Chat to recover its progress. **Stop** retains received text and completed
library additions. A restart interrupts an in-progress generation rather than
replaying its side effects; continue with a new message.

There is no permission-mode selector. Ask naturally to find evidence, connect
sources, save a link or create a note. A separate intent check reads only the
current authenticated user's request. Clear saves can execute immediately;
uncertain intent or a URL not present in that request produces an exact
proposal with **Confirm addition** and **Do not add** actions. Proposals expire
when the conversation is rewound. Retrieved text and derived memory cannot
grant permission. The assistant cannot delete or overwrite library content.

New notes and captures use the same publication, ownership, idempotency and
capture limits as the rest of Voxen. File attachments use the existing capture
upload pipeline. Captures are asynchronous: follow their job reference to
see progress or the final document. Sending a file starts its capture before
the conversational message is submitted.

## Checkpoints and memory

Edit a user message to replace it and generate another continuation. **Return
here** removes everything after the selected message. Both invalidate affected
executions, events and derived memory. Already published notes and documents,
and their durable action receipts, remain in the knowledge base.

Older turns are compacted into a structured working memory containing goals,
decisions, constraints, source-linked facts, open work and uncertainty. Recent
turns remain verbatim; original retained history is available through bounded
history search. Memory is derived conversational context, not a library note
or a permission grant. Compaction uses the fast role and contributes to the
recorded model usage. A conservative byte budget reserves room for tools and
output; an oversized current request must be shortened or uploaded as a file.

## Optional web research

Chat preferences can enable web tools and store a personal Brave Search API
key. Keys are encrypted with `MASTER_KEY`; responses expose configuration
status only. Disabling research removes those tools from subsequent turns.
You can also remove the stored search key in preferences.

Discovery uses Brave's fixed API endpoint. Page reads use the existing isolated
capture worker and its public-network egress policy. Results retain URLs and
retrieval timestamps, and web references are distinguished from library
references. No arbitrary shell, execution sandbox or local text model is added.

## Implementation boundaries

- Vercel AI SDK owns the bounded multi-step model/tool loop. Explicit provider
  instances retain per-user credentials and configured role fallback.
- PostgreSQL owns conversations, execution leases, revision fences, replayable
  events, proposals, receipts and structured memory. SSE is a view of that
  durable state, not the execution's lifetime.
- The installed Astryx Chat composer, input, message, bubble, list, tool-call
  and scrolling primitives inherit Voxen's existing Light/Dark tokens.
- Fallback is allowed before a provider emits text or calls a tool. After work
  becomes observable, failure retains it instead of automatically replaying
  the turn through another provider.
- One conversation can execute at a time, with 12 model steps, 36 tool calls,
  three additions and six web calls per run. Knowledge reads remain bounded
  and owner-scoped; private reasoning and credentials are never streamed.

See [spec 228](../.specs/228-continuous-knowledge-assistant.md) and ADR-017 in
[decisions](DECISIONS.md). Background enrichment and passage indexing are
separate increments specified in specs 229 and 230; this assistant does not
claim to implement them.
