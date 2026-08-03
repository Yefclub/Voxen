# Spec 157 — User-owned interface mode

## Context

Voxen currently exposes one desktop shell: the navigation floats as a panel
beside an edge-to-edge content area. The Vesper `dev` shell demonstrates a
useful alternative hierarchy: navigation belongs to the background canvas,
while one inset, bordered surface carries the product content. The owner wants
both approaches available without turning a personal visual preference into
instance administration.

## Glossary

- **Classic mode**: the current Voxen shell, unchanged.
- **Focus mode**: a Vesper-inspired desktop shell where the sidebar/rail is
  background chrome and the main product surface is inset, rounded and
  visually elevated.
- **Interface mode**: the authenticated user's `classic | focus` preference.

## Requirements

### Ubiquitous

- The system shall keep `classic` as the default for existing and new users.
- The system shall persist interface mode on the authenticated user, never as
  an instance-wide setting or a browser-global preference shared by accounts.
- The account API shall derive the preference owner exclusively from the
  authenticated session.
- The system shall expose the effective preference through `/api/me` so every
  page uses the same shell contract.
- Both modes shall use semantic theme tokens and work in every Voxen theme.

### Event-driven

- When a user toggles interface mode from the desktop sidebar or rail, the
  system shall update the shell immediately and persist the choice.
- When a user selects a mode from the personal account page, the same preference
  shall update without navigating to administration.
- When a hidden tab becomes visible again, the system shall revalidate the
  authenticated preference so a change made in another tab is reflected.

### State-driven

- While focus mode is active on a desktop viewport, the sidebar or rail shall
  belong to the background canvas and the main application column shall render
  as one inset surface with a border, radius, clipping and restrained lift.
- While classic mode is active, shell geometry and existing navigation visuals
  shall remain unchanged.
- While the viewport is mobile, the existing full-width shell, drawer and
  bottom navigation shall remain unchanged regardless of the stored desktop
  interface mode.
- While a preference update is in flight, duplicate updates shall be disabled.

### Unwanted behavior

- If an unsupported interface mode reaches the API, it shall be rejected.
- If an invalid value exists in storage, `/api/me` shall fail closed to
  `classic`.
- If persistence fails, the optimistic visual change shall be reverted and the
  user shall receive feedback.
- Switching modes shall not remount route content, reset chat state, or create
  a horizontal/body overflow.

## Acceptance criteria

- [x] Prisma migration adds a per-user interface preference with a safe default.
- [x] Account and `/api/me` contracts read and update only the session owner.
- [x] Sidebar, rail and personal account offer accessible mode controls.
- [x] Focus mode implements the Vesper canvas/content hierarchy on desktop.
- [x] Classic mode and all mobile layouts remain visually unchanged.
- [x] Unit/integration tests cover normalization, invalid input and user isolation.
- [x] Typecheck, lint, relevant tests, production build and browser validation pass.

## Out of scope

- Rebuilding individual product pages or adopting Vesper's desktop window
  controls, typography or recording-specific components.
- Making interface mode an administrator policy.
- Changing theme identifiers or extension styling.

> 2026-08-03: scope approved by the owner as part of the product improvement
> study. Vesper `dev` was inspected as the structural reference.
