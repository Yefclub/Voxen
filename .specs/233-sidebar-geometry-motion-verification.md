# Spec 233 — Sidebar geometry and motion verification

## Context

The owner reported a misaligned capture action in the collapsed sidebar and
requested verification of every motion surface introduced by specs 231–232.
The current 64 px rail renders the capture action at 43 × 40 px, with its icon
4.5 px left of the rail axis. Shared button utilities override its intended
geometry. This correction preserves the established Voxen identity and layout.

## Requirements

### Ubiquitous

- Collapsed capture, navigation, toggle and account controls shall have 44 px
  square targets with their visible icons or avatars on the same rail axis,
  within one CSS pixel, in both appearances and supported locales.
- Expanded controls shall preserve readable labels and aligned icon cells.
- The conversation editor, draft, route and accessible control names shall
  survive shell motion and overlay interactions.

### Event-driven

- When the sidebar opens, closes or reverses, its controls, labels, workspace
  offset and conditional release region shall follow the same bounded 200 ms
  transition without an immediate internal layout jump or clipped controls.
- When a footer menu is open during a keyboard toggle, the system shall retain
  a usable menu anchor and restore focus to an available control on dismissal.
- When a user requests the latest chat message, the system shall finish at the
  latest response without moving the composer or erasing an earlier draft.

### State-driven

- While reduced motion is requested, the shell, composer, overlays, progress,
  message actions and scrolling shall use their non-spatial alternatives while
  keeping state changes and keyboard feedback available.
- While a stable release is available, the desktop release region shall fold
  with the sidebar rather than disappearing before the width transition. The
  existing expanded action and mobile presentation shall remain available.
- While the viewport is short or narrow, all navigation destinations and footer
  actions shall remain reachable without document-level horizontal overflow.

### Unwanted behavior

- If sidebar motion is interrupted repeatedly, then the final state shall match
  the latest requested state and shall leave no stalled animation or stale focus.
- If labels or account names are long, then their layout shall truncate rather
  than displace the icon axis or enlarge a collapsed control.

## Motion verification boundary

The audit covers the motion introduced or adapted in specs 231–232:

| Surface | Observable checks |
| --- | --- |
| Desktop shell | Width/inset synchronization, icon cells, text fading, footer/release folding, interruption, focus and menu anchors |
| Chat composition | Wrap/newline growth, retained expansion, empty shrink, attachment drawer, mounted editor and control bounds |
| Sources | Desktop panel geometry and phone-sheet entrance/dismissal, focus and retained drafts |
| Latest response | Floating control, scroll completion, unchanged composer and earlier reading position |
| Progress | Rotation, disclosure chevron and localized state with reduced-motion alternatives |
| Feedback | Message-action fades, button press/hover, library hover clearance and focus |
| Retained mobile shell | Drawer open/close, dismissal and reachable navigation at the desktop boundary |

## Acceptance criteria

- [ ] The reported endpoint defect has a failing regression before correction.
- [ ] Both endpoints, intermediate frames and reversals preserve the geometry
      and editor contracts in Chromium and WebKit.
- [ ] Light/Dark, PT-BR/English, admin/user, short and intermediate desktops,
      phone reflow and a high-density capture are covered.
- [ ] Every motion surface in the table has an observed result and explicit
      limits; screenshots alone do not establish transition behavior or frame rate.
- [ ] Independent visual and technical reviews, required checks and deployment
      verification are complete before delivery is declared.

## Out of scope

Identity redesign, new navigation destinations, backend/provider/schema changes,
unrelated pre-existing animation systems, physical-device or frame-rate claims.
