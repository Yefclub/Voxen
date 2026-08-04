# Spec 162 — Development version SemVer ordering

## Context

The development version workflow refreshed `0.13.1-dev.<timestamp>` after
`v0.13.1` reached `main`. Under SemVer, that prerelease is lower than the
stable release, violating the repository contract that `dev` must never trail
`main`.

## Requirements

- The workflow shall compare the current development package version with the
  stable version stored on `origin/main`.
- When the development core is equal to or lower than the stable core, the next
  development version shall use the next patch core.
- When the development core is already higher than the stable core, the
  workflow shall preserve that core and only refresh the timestamp.
- The resolver shall reject malformed current versions, stable versions, and
  build stamps instead of publishing an ambiguous version.
- The root and web package versions shall continue to receive the same resolved
  value.

## Acceptance criteria

- [x] `0.13.1-dev.<old>` against stable `0.13.1` resolves to
      `0.13.2-dev.<new>`.
- [x] `0.13.2-dev.<old>` against stable `0.13.1` remains on the `0.13.2` core.
- [x] A higher minor prerelease remains higher instead of being reduced to a
      patch line.
- [x] Stable and prerelease inputs, malformed values, and invalid timestamps
      are covered by deterministic script tests.
- [x] The workflow fetches `origin/main` explicitly and uses the tested
      resolver as its only version calculation.

> 2026-08-04: implementation authorized by the owner as part of the approved
> release completion and repository automation work.
