# Spec 227 — Readable action labels in constrained layouts

## Context

The owner supplied a reader screenshot where both personal Guide actions wrap
against their borders. The same state reproduces in the 280px desktop tools
column: a 40px label is drawn inside a 36px button. The shared Astryx adapter
allows wrapping while retaining the native single-line height. The feedback
card also chooses two columns from the viewport rather than its available width.

This is a refinement of the existing Voxen identity and the shared controls from
specs 225/226. It preserves all copy, personal preference semantics and mobile
sheet behavior.

## Requirements

### Ubiquitous

- Text buttons shall retain readable labels, balanced internal spacing and their
  established minimum hit size without clipping or painting text over borders.
- Icon-only controls shall retain their square geometry and centered glyphs.
- Shared controls shall retain accessible names, focus, refs, event handling,
  disabled behavior and native Astryx interaction behavior.
- Surfaces, focus, feedback and instruction colors shall use the existing Voxen
  Light/Dark semantic tokens.

### Event-driven

- When a text label wraps, its button shall grow to contain all lines and padding.
- When the Guide actions cannot fit on one row at their natural label widths,
  they shall move to separate rows within their own container.
- When a preference is submitted, its loading state shall remain readable and
  the existing selection, persistence, reversal and error recovery shall work.

### State-driven

- While text is enlarged to 200%, controls shall contain their labels and remain
  reachable without horizontal page overflow.
- While reader tools occupy a desktop column or a mobile sheet, Guide actions
  shall adapt to the local width rather than assuming the viewport is available.

## Acceptance

- [ ] Reproduce the original 36px button / 40px label failure before correction.
- [ ] Verify Guide controls in both locales and appearances at phone, tablet and
      desktop widths, including the 280px tools column and 200% text.
- [ ] Verify selected, disabled, pending, restored and retry states through the
      existing preference workflow without weakening its assertions.
- [ ] Inspect shared text-button consumers in Library, Capture, Notes and account
      tools; correct only observed instances of the same defect.
- [ ] Retain spec 226's sidebar/appearance alignment, focus and editor persistence.
- [ ] Complete independent visual and technical reviews, CI, dev delivery and
      verification of the deployed revision.

## Non-goals

No new visual world, branding, copy, recommendation behavior, ingestion policy,
backend/API/schema, dependency, fixed-height icon control or orientation policy.

> 2026-11-13: Created from the owner's Guide-actions screenshot and request to
> review and correct this class of control-layout defects.
