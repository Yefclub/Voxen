# Spec 206 — Release channel label and dev version guard

## Context

The sidebar update button compares the installed version against GitHub's
latest stable release. A dev instance whose version is numerically behind the
stable release — no push to `dev` since the release and the post-release sync
skipped — sees "v0.15.0 disponível" while running DEV. The label never says
which channel the available release belongs to, and the details line's "DEV"
describes the installed instance, so the notification reads as if the update
were a development build. The same drift also leaves production release
entries out of the development release feed.

The version-dev workflow already self-heals the number on the next push to
`dev`, and it validates the nine protected contexts before merging; it only
stalled because it required a `CLEAN` merge state, which advisory security
findings keep out of reach.

## Glossary

- **Installed channel**: the channel of the running build (`dev` or `prod`),
  derived from the version string.
- **Available channel**: the channel of the advertised release.
- **Protected contexts**: the nine required status checks configured for `dev`.
- **Drift**: the development version is not ahead of the latest stable version.

## Requirements

### Ubiquitous

- The update notification shall state the channel of the available release.
- The update status shall expose the available channel separately from the
  installed channel.
- The details line shall keep naming the installed channel explicitly.
- The system shall provide a guard that reports when the development version is
  not ahead of the latest stable version.

### Event-driven

- When the latest stable release is newer than the installed version, the
  notification shall label it with its channel.
- When the guard runs and the development version is behind, it shall fail with
  an actionable message.
- When the development version is ahead, the guard shall pass without side
  effects.
- When the version-dev workflow finds the nine protected contexts green, it
  shall merge even if a non-required check is failing.

### State-driven

- While the installed version belongs to the development channel, the details
  line shall name that channel before the current version.

### Unwanted behavior

- If the latest release is a draft, a prerelease, or an invalid tag, then the
  system shall keep hiding the notification and expose no available channel.
- If the development version is ahead of the stable release, then the guard
  shall not fail or mutate anything.

## Acceptance criteria

- [ ] A development instance sees the available release labeled with the
      production channel and the installed channel in the details line.
- [ ] The update status exposes the available channel as null whenever the
      release is draft, prerelease, or an invalid tag.
- [ ] The comparison tests cover the available channel for valid and invalid
      releases.
- [ ] The guard fails when the development version is behind the stable
      version and passes when it is ahead.
- [ ] The version-dev workflow merges a green version PR even when the merge
      state is `UNSTABLE` because of non-required checks.

## Out of scope

- Dependency upgrades for the failing advisory scans.
- Rewriting past release history.
- Changing which checks are required for `dev`.
