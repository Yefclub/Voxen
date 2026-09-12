# Spec 200 — Collapse the thinking block when the answer starts

## Context

The thinking block stays expanded for the entire final answer. The reasoning
timeline sits above the response while it streams, so the part that matters is
pushed down and competes with a wall of tool rows and reasoning text.

This is not an implementation defect. It is the trigger spec 130 chose:
`ThinkingBlock` receives `live={isStreamingAssistant}`, true from the first
token of the turn to the last, and `useThinkingDisclosure` schedules the
collapse only once `live` goes false. The block therefore collapses one second
after the whole turn ends.

Spec 130 was right to drop `thinkingInFlight`. That signal oscillates inside a
turn — open on reasoning, closed on text, open again on the next tool call — and
binding `expanded` to it made the block jump on every tool round trip. Moving to
`live` removed the jumping but moved the collapse to the wrong moment.

Every reference implementation collapses on reasoning end rather than turn end:
`vercel/ai-elements` `Reasoning` closes when the reasoning part stops streaming,
`assistant-ui` returns to `defaultOpen: false` on completion, MUI X Chat and
Nuxt UI both close when the streaming state ends. Spec 130 cites `ai-elements`
as its reference, but `ai-elements` renders one `Reasoning` per reasoning part,
each closing when its own part ends. Voxen renders one block per turn bound to
the turn. That is the divergence.

The signal already exists on the client. `message.content` is empty until the
first final-text delta arrives, and the render already depends on that. Nothing
new has to be plumbed through; only the disclosure ignores it.

## Glossary

- **Turn**: one assistant response, from the first streamed token to the last.
  One `ThinkingBlock` instance per turn, keyed by message id.
- **Live**: the turn's stream is still open.
- **Answer**: the final assistant text, as opposed to reasoning and tool rows.
- **Latch**: a one-way transition that does not revert for the rest of the turn.
- **Manual**: the reader operated the header, so automation stops for that turn.

## Requirements

### Ubiquitous

- The disclosure shall expose a single boolean for whether the block is open.
- The reducer shall remain pure, and the scheduler shall remain injectable, so a
  full agentic turn is exercisable without a DOM or a real timer.

### Event-driven

- When the first final-text delta lands on a live turn, the block shall
  collapse.
- When the reader operates the header, automation shall stop for the rest of
  that turn.
- When a turn ends with no final text, the block shall still collapse through
  the existing post-turn delay.

### State-driven

- While the answer has started, the block shall not reopen automatically, even
  if the harness calls further tools or the stream drops and recovers.
- While the turn is live, the header shall keep the activity shimmer.

### Unwanted behavior

- If the reader opened the block by hand, then the start of the answer shall not
  collapse it.
- If a message is rendered from history, then it shall mount collapsed and
  schedule nothing.

## Design

Add an `answer-started` event to `thinkingDisclosureReducer`, and an `answered`
flag to the state. The event collapses the block once and marks the latch;
`turn-started` then checks `answered` in addition to `manual`, so a stream that
recovers mid-turn does not reopen a block the answer already closed.

A latch does not bring back the spec 126 oscillation. The defect there was the
bidirectional binding to a signal that flips both ways inside a turn, not the
signal itself. One-way cannot oscillate. This reasoning belongs in the module,
because the file currently documents `live` as the only automatic trigger "on
purpose" and the next reader will ask exactly this question.

The header stays driven by `live`. There is still activity to signal while the
turn runs, which is what Cursor and Claude Code do, and it avoids touching
`thinkingDuration`, which returns `null` while live — switching to the summary
label mid-turn would render a tool count with no elapsed time.

**Rejected**: per-segment disclosure, one collapsible per `ReasoningSegment`
driven by its own `endedAt`. It is the literal `ai-elements` model and closer to
the references, but it multiplies boxes on an agentic turn and is a much larger
change to the render for the same perceived gain.

## Acceptance criteria

- [ ] A final-text delta on a live turn collapses the block.
- [ ] A tool call arriving after the answer started does not reopen it.
- [ ] A stream recovery after the answer started does not reopen it.
- [ ] A reader toggle before the latch keeps the block under manual control, and
      the answer starting does not collapse it.
- [ ] A reader toggle after the latch keeps manual control for the rest of the
      turn.
- [ ] A turn that ends with tools only, and no final text, still collapses
      through the post-turn delay.
- [ ] A history message mounts collapsed and schedules nothing.
- [ ] The header shows the shimmer while live and the summary with duration once
      the turn ends.

## Out of scope

- Per-segment disclosure, rejected above.
- Any change to `thinkingDuration`, `thinkingSummaryLabel`, or the header
  markup.
- The scroll and anchoring behaviour around the block.
