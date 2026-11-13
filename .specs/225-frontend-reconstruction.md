# Spec 225 — Complete frontend reconstruction and mobile capture journeys

## Context

The owner requested a complete reconstruction of the Voxen frontend, including
authentication, all internal pages and the installed mobile PWA. The supplied
capture screenshot shows inconsistent content alignment, weak hierarchy and an
error-heavy history. The shared-content journey must focus on the submitted
content and open its analyzed document after completion.

The owner named [Astryx](https://github.com/meta/astryx) and
[Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance-src)
as required references. Product truth remains a self-hosted knowledge library
with capture, deterministic retrieval, notes and MCP, rather than a commercial
multi-tenant service. Existing stored documents and public API contracts remain
the source of truth.

## Requirements

### Ubiquitous

- The system shall use one coherent visual language for public authentication,
  onboarding, workspace, content, account and administration interfaces.
- The system shall preserve the Voxen name and recognizable brand asset,
  existing product capabilities, stored data, workspace isolation and safe
  authentication, approval and authorization behavior.
- The system shall provide Light and Dark modes with one Voxen identity, map
  existing appearance preferences to the corresponding mode and retain both
  supported interface languages.
- The system shall align ordinary page headers and content to shared workspace
  gutters; reading content shall use a readable text measure inside that grid.
- The system shall provide keyboard-visible focus, accessible labels, semantic
  headings, announced actionable errors and reduced-motion behavior.
- The system shall provide usable layouts at 320, 390, 768, 1280 and 1920 CSS
  pixels without document-level horizontal overflow.
- The system shall keep primary touch controls at least 44 CSS pixels in both
  dimensions, including navigation and dialog dismissal.

### Event-driven

- When an authenticated user shares content into the PWA, the system shall show
  the submitted content, its processing state and relevant actions before the
  capture history.
- When the capture currently opened or submitted in that foreground journey
  finishes with an owned document, the system shall navigate once to that
  document, including captures completed with warnings.
- When a shared item already exists, the system shall provide the existing
  document as the result without requiring a second capture.
- When a background capture or an older history item finishes, the system shall
  update its status without navigating away from the user's current task.
- When a user returns from authentication with a shared GET link, the system
  shall preserve the link and require confirmation before enqueueing it.
- When a user opens or dismisses mobile navigation, dialogs or sheets, the
  system shall preserve focus, scroll access and reachable close actions.
- When the viewport or virtual keyboard changes, the system shall keep active
  fields, navigation and submission controls usable without overlapping content.
- When a user switches application sections, the system shall provide consistent
  navigation and scroll behavior while preserving detail/editor state where
  the existing flow requires it.

- When search or a related-node selection replaces the graph topology in 3D,
  the system shall publish a coherent scene, retain 3D mode and permit source
  navigation without an intermediate renderer exception.

### State-driven

- While a capture is processing, the system shall expose clear progress and
  cancellation without presenting provider metadata as the primary content.
- While an error prevents capture, the system shall explain the outcome and
  offer only actions supported by the returned public error contract.
- While the application is installed, the system shall account for safe areas,
  dynamic viewport height and touch navigation throughout every route.
- While the interface uses a narrow touch viewport, filters, contextual actions
  and short editing/confirmation flows shall use reachable sheets rather than
  small centered desktop dialogs, while retaining accessible focus and dismissal.
- While a page is loading, empty, unavailable or forbidden, the system shall
  provide an appropriate readable state without exposing sensitive internals.
- While a graph or editor owns its viewport, the system shall preserve its
  interaction space and the graph framing protections delivered in spec 224.
- While graph topology is unchanged, the system shall retain camera navigation
  across selection, hover and appearance updates.

### Optional

- Where installation is supported, the system shall offer PWA installation
  without repeatedly interrupting capture, authentication or content reading.
- Where a platform lacks an enhanced browser capability, the system shall keep
  the essential workflow available through a supported fallback.

### Unwanted behavior

- If a capture fails or is cancelled, then the system shall preserve the
  submitted content and recovery actions without redirecting to a missing result.
- If a stale event arrives after navigation or cancellation, then the system
  shall not navigate to a different or foreign document.
- If a client is offline, then the system shall explain the unavailable
  operation without representing unsaved or unqueued data as successful.
- If an update is available, then the system shall preserve the existing safe
  update/reload behavior and avoid losing an active form or shared-item intent.

## Screen and workflow coverage

Public: login, sign-up, pending approval, QR login, OAuth consent and onboarding.
Workspace: library/search/filters, document reading and actions, captures and
share-target outcomes, notes list/editor, graph 2D/3D, guide and release notes.
Account: profile/security, MCP connections/tokens and AI providers.
Administration: configuration, users, integrations and authentication settings.
Cross-cutting: navigation, theme selection, dialogs, empty/error/loading states,
install prompt, offline/update states and touch/keyboard interaction.

## Acceptance criteria

- [x] Baseline desktop/mobile inspection records every supported route family.
- [x] A documented visual direction and component/token system replace the
      inconsistent frontend, with Astryx used in the delivered UI.
- [x] Capture and share journeys prioritize content and redirect only their
      foreground result, with regressions for terminal states and stale events.
- [x] Every listed screen family is reconstructed and visually checked at its
      shipping sizes; shared interactive controls and page-specific workflows
      are exercised with safe isolated fixtures for data-changing operations.
- [x] Mobile safe areas, touch targets, keyboard/scroll behavior, PWA metadata,
      share target, offline states and installation/update behavior are checked.
- [x] Mobile sheets expose their actions, dismissal and scrollable content with
      the virtual keyboard open; equivalent desktop controls remain usable.
- [x] Both appearance modes and locales retain their complete UI contracts;
      keyboard focus, error announcements and reduced motion are verified.
- [x] Existing security, workspace, ingestion, MCP, graph and data-preservation
      contracts pass without weakening tests or quality/security gates.
- [x] A 500-node 3D overview transitions to search results and related nodes
      without renderer exceptions, retains 3D and opens an owned source.
- [ ] Required checks, real builds, independent code/visual review and remote CI
      pass; the change merges to dev and the updated deployment is verified.

## Out of scope

Changing authentication policy, stored content, AI provider behavior, capture
worker algorithms, billing, new commercial claims, API/schema redesign and
production credentials. Apart from the explicitly approved appearance
consolidation, no feature is removed merely to simplify the design.

## Validation constraints

Native mobile share sheets and OS installation prompts require a real device;
browser emulation shall be described as emulation rather than device evidence.
Destructive and credential-changing actions shall be tested with isolated data.

> 2026-11-12: Scope follows the owner's complete reconstruction request.
> The owner confirmed one Voxen identity with Light/Dark appearance instead
> of the four existing packs. Baseline inspection and the documented direction are complete.
> The owner additionally requested mobile-appropriate sheets instead of desktop
> modal presentation for contextual tasks.

## Local validation status

The implementation uses Astryx controls and the semantic system recorded in
[DESIGN.md](../DESIGN.md). The complete route/appearance/locale matrix contains
354 captures, including 320px, 390px, tablet, desktop and landscape layouts.
The final graph headroom correction has sixteen additional affected captures.
The matrix's 176 accessibility scans and the eight graph follow-up scans report
no violations. Browser evidence uses isolated demonstration data and sandboxed
Chromium/WebKit; OS-level share choosers, installation and physical software
keyboards remain unverified.

At source revision `15531ca0be10a281d6dc65fa41ca881b9ef328ce`, the full application
suite passes 1,487 tests. All 125 automation contracts were exercised, including
the two PostgreSQL migration-preservation regressions run separately against
isolated databases. The compiled Chromium suite passes 24 browser workflows;
WebKit also covers the affected appearance, installation and history geometry.
Lint, typecheck, formatting, the production dependency gate, the fresh quality
gate and the actual Dockerfile build pass. No quality/security baseline was relaxed.

Independent visual review scored all six material findings resolved and then
confirmed the separate graph-label clipping correction with no introduced visual
regression. The design system is documented. Exact-final independent technical
review, remote CI, merge to dev and live deployment verification remain pending.

## Deployed graph follow-up

The initial deployment at `e4020cc5` reproduced a Reagraph edge-label failure
while search replaced the 500-node overview with a focused graph. The edge-label
renderer accessed an endpoint absent from its internal node map during that
transition and fell back to 2D. A separate settled capture confirmed the 3D
overview was rendered; the earlier immediate camera capture preceded its paint.
The follow-up shall cover a real renderer transition from a dense overview to a
focused scene, assert that 3D remains selected with no page exceptions, and open
an owned source through a related node. Existing camera-persistence and WebGL
fallback contracts remain required. Production-data diagnostics stay outside
the repository; the regression uses synthetic isolated workspace data.
