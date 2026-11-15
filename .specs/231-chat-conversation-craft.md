# Spec 231 — Focused conversation and composer

## Context

The owner requested a Grok-informed improvement of the chat on 2026-11-15 and
confirmed that Voxen navigation must remain intact. The reference is
[grok.com](https://grok.com/), inspected in the shared browser on desktop and
phone. The owner also requested [chatgpt.com](https://chatgpt.com/) as the
conversation reference; an anonymous test response was observed. Their writing
surface, reading hierarchy and message alignment inform this refinement;
Voxen retains its own identity and capabilities.

Grok exposed empty, composing and user-message states; its assistant response
required authentication. ChatGPT exposed a complete anonymous response, including
its reading hierarchy and message/composer alignment. Neither reference grants
access to private content or changes Voxen's conversation contracts.

The owner subsequently expanded the scope to the desktop shell: replace its
floating content frame with a flat workspace, renew the sidebar using the
[shadcn sidebar composition](https://ui.shadcn.com/docs/components/sidebar), move
global controls into its footer and chat preferences into the composer. Existing
Voxen colors, type, navigation destinations and mobile chrome remain authoritative.

## Requirements

### Ubiquitous

- The system shall retain the existing navigation, Light/Dark identity, single
  continuous conversation and owner-scoped knowledge operations.
- The system shall align messages, source disclosures and the composer to one
  reading column with a maximum width of 46rem and responsive side gutters.
- The system shall align assistant prose to the composer's left boundary and
  the user bubble to its right boundary, within 2 CSS pixels at tested widths.
- The system shall distinguish a compact tonal user message from open assistant
  prose and keep message actions subordinate to the answer.
- The system shall provide keyboard-visible focus, localized accessible names,
  at least 44px touch targets and reduced-motion behavior.
- On desktop, the system shall use a full-height sidebar with a scrollable grouped
  navigation, fixed brand/actions and account/appearance footer, separated from
  the flat main workspace by one rule, without an inset frame or reserved topbar.
- The desktop sidebar shall collapse to an accessible icon navigation while
  preserving the active route, drafts, editor identity and toggle focus.
- Chat preferences shall remain reachable inside the composer in compact,
  expanded, active and mobile states, without replacing the draft.
- The attachment action shall use a centered unfilled plus glyph with an intact
  44px target and theme-responsive hover/focus treatment.
- The initial 3D overview shall retain Voxen's complete framing after the renderer
  finishes initialization; its library shall not replace that frame with a
  competing automatic fit. Selection and theme changes shall preserve the camera.
- Sparse 3D scenes shall scale their labels to the scene extent without shrinking
  their existing node markers; representative text shall remain inside the canvas.

The desktop regression sweep exposed this last pre-existing defect on the exact
base and candidate with the same three-node fixture: the renderer's asynchronous
automatic fit overwrites Voxen's complete fit, while the manual Fit action restores
it. The scoped correction preserves the existing graph contract and is covered
by actual canvas evidence rather than only simulated camera controls.

### Event-driven

- When the inline text wraps or contains a line break, the composer shall put
  the same editor above its attachment/send row and grow with the draft up to
  six visible lines, then scroll internally without obscuring its actions.
- While a previously expanded draft remains nonempty, the composer shall retain
  its expanded layout when the draft becomes short again.
- When the draft is cleared, the composer shall return to its compact height.
- When the first message appears, the system shall retain the mounted editor,
  its draft and the current focus while docking it beneath the conversation.
- When a user opens sources or execution details, the system shall reveal the
  existing information without hiding the answer or moving the composer.
- When a user copies an answer, the system shall copy its complete text and
  announce success or a recoverable failure.

### State-driven

- While the conversation is empty, the system shall present one restrained
  invitation, a compact composer and quiet task suggestions.
- While a nonblank draft or phone keyboard is present, the system shall hide
  starter suggestions and preserve the draft.
- While a response streams, the system shall present incremental readable text,
  one expandable activity line and a reachable stop action.
- While the user reads older messages, streaming shall preserve their reading
  position and offer a return to the latest response.

### Unwanted behavior

- If loading or submission fails, then the system shall preserve the draft and
  show actionable feedback without inventing a response or successful action.
- If the viewport narrows or a phone keyboard opens, then the system shall keep
  the composer and sheets reachable without page-level horizontal overflow.

## Acceptance criteria

- [ ] Reference observations and before/after captures identify their revision.
- [ ] Empty, composing, streaming and populated views work at desktop and phone
      widths in both appearances, including long prose, lists and code.
- [ ] The empty composer is at most 72px high; long drafts grow and shrink.
- [ ] Copy, sources, preferences, uploads, stop, edit and rewind remain usable.
- [ ] Editor identity, drafts, announcements, scroll position and mobile sheets
      retain their existing behavior.
- [ ] Browser checks and independent visual and technical reviews pass before
      delivery through dev and deployment.

## Out of scope

Mobile navigation redesign, new appearance packs, Grok branding/assets, session lists,
conversation permission modes, provider/backend changes and library mutations
outside the existing authorized tools.
