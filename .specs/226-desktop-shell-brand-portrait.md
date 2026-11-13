# Spec 226 — Desktop shell, brand mark, and portrait mobile use

## Context

The owner rejected the desktop shell's lack of visual separation and supplied
a Library screenshot whose hovered row touches its content at both edges.
The mobile navigation and sheets are approved. The owner requests an entirely
new minimal symbol without an owl, text, or background, and portrait-only
phone use. This extends spec 225 without replacing the approved mobile layout.

Recent capture diagnostics are investigated separately from presentation.
The latest Firecrawl capture completed with `speech_not_transcribed`; its
speech step reported non-retryable `UNSUPPORTED`. A partial result must remain
honest about which source material was analyzed.

## Requirements

### Ubiquitous

- The desktop interface shall distinguish global navigation, the header, and
  page content using the established Light/Dark identity.
- The interface shall retain all authorized destinations, ownership controls,
  account actions, sidebar persistence, editor drafts, and graph behavior.
- The mobile interface shall retain its bottom navigation and contextual sheets.
- The application shall use the requested design system's behavior-bearing
  navigation, account menu, appearance controls, and controlled search/capture
  fields instead of limiting adoption to a styled button.
- Shared component adoption shall preserve form submission, native field
  identity, input refs, asynchronous request ownership, mobile geometry, and
  public API contracts.
- The brand symbol shall contain no text, background, or owl imagery and shall
  replace the old symbol across authentication, navigation, browser icons,
  installed-app icons, and error states.

### Event-driven

- When a desktop user hovers or keyboard-focuses a Library row, the visible
  treatment shall leave at least 12 CSS pixels between each horizontal edge
  and its content without moving the row's content.
- When the sidebar is hidden or restored, focus shall move to its corresponding
  visible control and the current document/editor shall stay mounted.
- When a sidebar control is rendered as an icon-only button, its glyph shall
  share the button's vertical center; the collapsed-sidebar control shall also
  align with the adjacent breadcrumb without a text-baseline offset.
- When users open an account or appearance menu, keyboard navigation, dismissal,
  focus return, and accessible names shall remain usable without leaving
  focusable background controls hidden from assistive technology.
- When a user clears a Library query, the search field shall retain focus and
  the existing URL/filter synchronization shall apply.
- When a phone is rotated to landscape, the application shall request portrait
  orientation where supported and otherwise show a portrait instruction that
  prevents interaction with the underlying application.
- When the phone returns to portrait, the application shall restore access and
  previous focus without losing unsaved input or restarting a capture.

### State-driven

- While the software keyboard reduces a portrait phone's visual viewport,
  the application shall remain usable and shall not show the rotation guard.
- While the app runs in a desktop or tablet browser, it shall not display the
  phone orientation instruction.

### Optional

- Where the installed web app supports manifest orientation, it shall launch
  in portrait mode.
- Where native orientation locking is available to the installed app, the
  application shall request it without requesting fullscreen.

### Unwanted behavior

- If the browser rejects orientation locking, then the application shall retain
  its portrait instruction without an unhandled error or a false success claim.
- If recent captures contain warnings or failures, then the investigation shall
  distinguish partial publication, unavailable upstream content, and application
  failures using current job state and observed diagnostic records.

## Acceptance criteria

- [ ] Desktop shell uses the requested navigation stack and has distinct chrome
      and content at 1280, 1440, and 2000 CSS pixels in Light and Dark.
- [ ] Library row hover/focus has measured horizontal inset and stable content
      positions; long titles and metadata do not overflow.
- [ ] Navigation, account actions, appearance, and collapse/restore work with
      keyboard and pointer; route contents are preserved during collapse.
- [ ] Sidebar control glyphs remain centered in Light/Dark at desktop widths
      and 1x/1.5x display scale, including the collapsed header state.
- [ ] Native design-system menus, appearance selection, and controlled fields
      are exercised through real keyboard, clear, submit, busy, and error states;
      search and capture mobile contracts retain their geometry and behavior.
- [ ] The replacement logo has actual transparency, is legible at small sizes,
      and appears in every existing brand and PWA icon location.
- [ ] Phone portrait/landscape transitions preserve unsaved input, block
      background controls, restore focus, and tolerate unsupported native APIs.
- [ ] Portrait keyboard resizing, desktop landscape, and tablet landscape remain
      usable; approved mobile sheets and navigation retain their behavior.
- [ ] Recent capture logs and outcomes are reported with observed causes and
      remaining uncertainty, without exposing credentials or source payloads.
- [ ] Required local checks, independent reviews, exact-head CI, deployment,
      and authenticated verification of the deployed revision pass.

## Out of scope

Database/authentication/provider policy changes; removal or reprocessing of
existing documents without a demonstrated reason; a new mobile navigation
design; changes to graph topology or retrieval contracts; control of the
operating system outside the browser's capabilities.

## Decisions and limits

The owner has authorized implementation, testing, dev integration, and deploy.
Use current emerald/ink/ivory tokens and the approved type system. The desktop
shell is a focused structural redesign, not a new application-wide palette.
The approved replacement symbol supersedes the old-logo commitment in PRODUCT.
Browser emulation does not establish native orientation behavior on hardware.
The phone guard applies to coarse-pointer devices whose shorter physical screen
dimension is below 600 CSS pixels. The manifest's portrait preference applies
to installed apps, including installed tablets whose platform honors it.

> 2026-11-13: Created from the owner's desktop screenshot and explicit follow-up.
> 2026-11-13: Expanded after the owner's explicit request to use Astryx beyond
> navigation and styled buttons; existing mobile navigation remains approved.
> 2026-11-13: Added icon-only glyph centering after the owner's collapsed-header
> screenshot exposed a text-baseline offset inside the shared button adapter.
