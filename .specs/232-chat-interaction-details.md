# Spec 232 — Conversation interaction details

## Context

The owner requested interruptible desktop sidebar transitions informed by the
shadcn sidebar, removable file previews before capture submission, a floating
return-to-latest button, a separate sources panel, and symmetric library-row
hover spacing. ChatGPT is the requested behavioral reference. This extends the
existing Voxen Light/Dark identity and spec 231, retaining mobile navigation,
the continuous conversation and existing authorization/publication contracts.

## Requirements

### Ubiquitous

- The desktop sidebar and workspace shall share one interruptible 200 ms
  transition between expanded and icon states, without losing route, draft,
  mounted editor or keyboard access. Reduced-motion users shall receive the
  same final geometry without spatial animation.
- Library hover/focus backgrounds shall retain equal 8 px vertical clearance
  from the row separators, preserving aligned content gutters and continuous rows.
- Source references shall retain their recorded titles, classifications and
  links; opening a reference shall not discard the current conversation or draft.

### Event-driven

- When a user selects, drops or pastes a supported file into the chat, the system
  shall stage a named, sized preview with a remove action before any upload or
  capture job is created. Images shall have a local thumbnail; other formats
  shall have an identifiable file presentation.
- When the user sends a staged attachment, the system shall upload it through
  the existing owner-scoped capture endpoint and include its job reference in
  the submitted message, supporting attachment-only messages.
- When upload or message submission fails, the system shall preserve the draft
  and attachment with actionable retry feedback. A successful upload shall not
  be repeated merely because the subsequent message submission failed.
- When the sources action is activated, the system shall open a labeled,
  independently scrollable side panel at widths of at least 1024 CSS pixels and
  a sheet on narrower viewports, with
  close/Escape behavior, focus restoration and no composer replacement.
- When the user reads earlier messages, the system shall offer one compact
  circular return-to-latest control over the transcript without adding a
  full-width background or changing the transcript/composer geometry.

### State-driven

- While sending or uploading, the system shall prevent duplicate submission and
  changes to the attachment being submitted, while retaining visible progress.
- While sources are open at widths of at least 1024 CSS pixels, the answer and
  writing surface shall remain available; narrower viewports shall preserve the
  draft while their sheet owns focus.
- While the source panel, sidebar or theme changes, the system shall preserve
  the mounted conversation editor and the user's current draft.

### Unwanted behavior

- If an attachment is removed before sending, the system shall create no capture
  job and shall release any local preview resources.
- If the viewport narrows, localized text grows or the keyboard appears, then
  attachments, panel controls and the composer shall remain reachable without
  document-level horizontal overflow.
- If a response is streaming while the user reads older messages, then the
  system shall preserve their reading position until they request the latest.

## Acceptance criteria

- [ ] Local before/after evidence and reference observations identify revisions.
- [ ] Sidebar opens, closes and reverses mid-transition; the icon rail remains
      usable and editor identity/drafts survive, including reduced motion.
- [ ] File and image previews can be removed before any upload; failed uploads
      and failed chat submissions retain retryable state without duplicate jobs.
- [ ] Sources open beside the desktop conversation and as a phone sheet; close,
      Escape, focus restoration, source navigation and retained drafts work.
- [ ] The latest-message button floats over the transcript, with transparent
      surrounding space and no layout shift when it appears or disappears.
- [ ] Hover and focus clearance are symmetric above/below library rows.
- [ ] Desktop/mobile, Light/Dark, English/Portuguese and retained assistant
      workflows pass focused browser checks and independent reviews.

## Out of scope

New conversation sessions, permission modes, model/provider changes, backend
capture contracts, deletion of already published captures, mobile navigation
redesign, and new theme/token systems.
