# Spec 219 — Edge-to-edge knowledge workspace and tab-free reading (Product 1 UI)

## Context

Product 1 needs a restrained, cohesive knowledge-workspace interface: one
edge-to-edge shell, a persistent header, shared controls, open reading
sections, and stable readable graphs. Baseline `dev` at `875d4c1`.
Reference: live-preview package verified by SHA256
(`source-and-evidence.zip` = `8d2cdbd72385860de785eb825782567c44c65e31887ca1eddcb0f4fbd4e0d52f`,
matching the published `SHA256SUMS.txt`; manifest `MANIFEST.json` pins
baseline `95524cf`, final iteration `open-reading-sections`, 39
changed/new source snapshots).

Verified porting boundary (static inspection of reference vs current `dev`):

- The reference was built on the pre-Product-2-removal baseline: it still
  carries `ai@7.0.62`, `@openrouter/ai-sdk-provider@3.0.0`, `three@^0.184.0`,
  and `pages/chat.tsx`. None of these exist in current `dev` and none are
  ported: `three` is referenced only by an i18n string, with no 3D code in
  the 39 snapshots.
- The only dependency the port adds is `@base-ui/react@1.9.0` (exclusive
  appearance controls and graph search), plus lockfile entries. Sigma stays
  at `^3.0.3` on both sides: no renderer upgrade.
- 32 of 39 reference files exist in current `dev`; 7 are new
  (`knowledge-graph-canvas.tsx`, `toggle-group.tsx`, `icon-button.tsx`,
  `disclosure.tsx`, `graph-labels.test.ts`, `pages/chat.tsx`,
  preview spec). `pages/chat.tsx` stays excluded (Product 2 removed).
- Current `dev` still ships the classic/focused selector
  (`client/lib/interface-mode.ts` + test + sidebar/account references):
  the selector is removed by this spec, not preserved.
- Preview Product 2 mentions are benign (an OpenRouter-key comment, a
  `chat-mode` pattern comment). They carry no routes, providers, or
  execution and are not ported as behavior.

## Glossary

- Shell: edge-to-edge page surface with a stationary mounted sidebar; the
  opaque page covers/reveals the sidebar, which never slides or fades.
- Open section: ordinary readable content block, never a disclosure bar,
  accordion header, or tab strip.
- Inspector: bounded scrolling pane showing the selected node in full
  (name, description, relations, all evidence).
- Framed camera: Sigma 3 camera driven in framed coordinates centered on
  `(0.5, 0.5)`, not graph-space coordinates.
- Measured labels: per-frame text-rectangle collision resolution, not
  truncation alone.
- Coverage: the execution account of one operation over its specified
  set/query. Never presented as semantic recall or truth.

## Requirements

### Ubiquitous

- The system shall render one knowledge-workspace interface with no
  classic/focused selector and no collapsed desktop icon rail.
- The system shall keep Voxen identity, typography, semantic color tokens,
  four theme packs, and native interaction conventions.
- The system shall reuse styled shadcn primitives and existing Base
  UI/Radix capabilities, and use icons only through
  `@/components/ui/icons`.
- The system shall keep Product 1 routes and data contracts intact and
  keep Product 2 removals intact (no chat/agent execution, providers,
  transcription, scraping, research, or generation reintroduced).

### Event-driven

- When the sidebar toggles, the system shall keep it mounted and
  stationary, move only the opaque page, preserve state and scroll
  position across toggles and reloads, and keep navigation icons static.
- When collapsed, the system shall reserve no sidebar width and keep
  hidden navigation inert (outside the accessibility tree and pointer /
  keyboard reach).
- When appearance or account controls open, the system shall animate
  both directions (reference 220ms in / 160ms out, reduced-motion
  alternative), dismiss on Escape/outside, restore focus, and never open
  tooltips from focus transfer alone.
- When a graph container resizes (including sidebar transitions), the
  system shall schedule processing and repainting so rendered pixels
  remain, never a mounted-but-cleared canvas.
- When camera, theme, selection, or metadata change without topology
  change, the system shall preserve camera/zoom and node positions and
  refit only on meaningful topology/view change or explicit action.

### State-driven

- While the desktop shell is available, the system shall fill the top,
  bottom, and right viewport edges (288px sidebar, 16px left page
  corners, 56px persistent header, controls ~12px from page edges).
- While reading content, the system shall present prepared material,
  metadata (compact label/value rows), linked notes, corrections, and
  history as open sections with the reading surface always visible.
- While a local graph is available, the system shall show it as an open
  bounded section (desktop map + inspector ≈ 420px; narrow ≈ 300px map +
  260px inspector, columns below ≈ 680px component width), load
  read-only data on mount, and show all evidence in the inspector
  without tabs and without silently keeping only the first excerpts.
- While labeling the graph, the system shall resolve collisions with
  measured per-frame text rectangles, reset occupied regions each
  frame, keep full names in the inspector, and clamp hover labels to
  the viewport.
- While WebGL is unavailable, the system shall retain the interactive
  SVG fallback with keyboard selection, announcements, focus, and
  viewport controls.

### Optional

- Where the reference switches layout at a 680px component width, the
  system shall adapt the threshold only if necessary to preserve
  readable geometry.

### Unwanted behavior

- If a held pointer press occurs on a full-width surface, then the
  system shall not shrink it away from its borders (no generic
  press-scale on panel-filling surfaces).
- If a compilation fails, then the system shall not hide previously
  materialized knowledge or present the failure as success.
- If a search misses, then graph search shall offer a clear reset, not
  a dead end.
- If a change only touches engine, browser, or network availability,
  then analysis may continue source-based while rendered checks stay
  explicitly unverified, never success.

## Acceptance criteria

- [ ] Single interface; classic/focused selectors and collapsed desktop
  rail gone; page fills top/bottom/right edges with only the intended
  left sidebar connection.
- [ ] Sidebar mounted/stationary; hidden navigation inert; state/scroll
  preserved across toggles/reload; static icons; rapid reversals and
  reduced motion correct.
- [ ] Persistent 56px header with page-edge alignment, left reopen
  control, original close position, and correct focus transfer.
- [ ] Appearance/account controls separate; four themes with desktop
  light/dark shortcuts; keyboard and pointer paths work.
- [ ] Menus/popovers/selects animate both directions, dismiss
  correctly, restore focus, no phantom tooltips.
- [ ] Shared components consistent across themes; full-width rows keep
  boundaries on hover/focus/held press.
- [ ] Library search prominent; prepared content/metadata/notes/history
  as open sections; draft preserved when composer hidden; anchors and
  stale/unavailable states preserved.
- [ ] Local graph open and bounded under long names and 18+ evidence
  excerpts; labeled scope selector (no tab strip); explicit All-nodes
  return with query/focus preserved.
- [ ] Camera/positions/zoom stable; resize repaints real pixels; labels
  readable without overlap; SVG fallback usable.
- [ ] Full-graph search/filters/reset, responsive details, and
  empty/error/partial/failed states without misleading state or
  inspector overlap.
- [ ] Port verified at 320/390/820/1024/1280/1600/2560px, four themes,
  normal/reduced motion, pointer/keyboard/touch paths, long/missing
  content, and WebGL failure, with inspected before/after states.
- [ ] No Product 2 behavior restored; no `ai`/`openrouter`/`three`
  dependencies added; only `@base-ui/react` plus lockfile entries.
- [ ] Reproducible build and container redeployment pass; superseded
  renderers/wrappers/dead styles removed.
- [ ] Spec/design docs updated to the final interaction; no abandoned
  tab/accordion requirement reintroduced.

## Delivery

Focused PRs against `dev`, reusing the repository workflow (independent
review, green CI, squash merge):

1. Shell, stationary sidebar, persistent header, appearance/account
   separation.
2. Shared controls, overlay motion, tooltip/focus fixes, library
   hierarchy.
3. Shared graph renderer, camera/label/resize corrections, bounded
   inspectors, fallback.
4. Open document/metadata/note sections and tab-free local graph
   navigation on the prepared-content model.
5. Integrated visual/accessibility/regression verification and normal
   source-based delivery.

## Out of scope

Model execution, content acquisition, backend retrieval/indexing
redesign, runtime security upgrades, agent/skill infrastructure,
application-wide primitive replacement, billing, chat/history products,
voice/STS, corporate publishing, and findings from other applications
presented as proven Voxen defects or guarantees.
