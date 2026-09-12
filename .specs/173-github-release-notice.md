# Spec 173 — Published GitHub release notice

## Context

The changelog describes changes bundled in the running image, but the product
does not indicate when GitHub has a newer stable release. The notice must
distinguish development and production builds without acting as an automatic
updater.

## Requirements

### Ubiquitous

- The system shall query only the latest stable release of `Yefclub/Voxen`
  through an authenticated backend endpoint.
- The system shall compare SemVer values after removing only a leading `v`.
- The system shall identify `-dev.*` versions as development builds and stable
  versions as production builds.
- The system shall keep GitHub access server-side behind a fixed URL, cache,
  and ETag validation.

### Event-driven

- When a stable release is newer than the installed version, the system shall
  show a release button immediately above Changelog in the expanded sidebar,
  collapsed rail, and mobile drawer.
- When a user activates the notice, the system shall open the corresponding
  official release in a new tab without opener access.
- When build `X.Y.Z-dev.*` is running and stable release `X.Y.Z` exists, the
  system shall treat that stable release as available.

### State-driven

- While there is no newer release, the system shall omit the notice entirely.
- While the notice is visible, the system shall expose the available version,
  installed version, and DEV or PRODUCTION environment accessibly in both
  supported languages.

### Unwanted behavior

- If GitHub is unavailable or rate-limited, or returns an invalid, draft, or
  prerelease tag, then the system shall fail silently and hide the notice.
- If the installed version is invalid or unknown, then the system shall not
  claim that an update is available.

## Acceptance criteria

- [x] The API uses conditional caching and never accepts a repository or URL
  supplied by the client.
- [x] Comparisons cover stable, prerelease, equal, older, and invalid versions.
- [x] The notice appears only for a newer stable release.
- [x] DEV and PRODUCTION are explicit in English and PT-BR.
- [x] Expanded sidebar, collapsed rail, and mobile drawer use the same order.
- [x] The action opens only the matching official GitHub release.
- [x] External failures produce no toast, modal, or navigation instability.
- [x] Unit tests cover SemVer, URL preservation, server caching, and client
  request coalescing; manual Playwright validation covers expanded, collapsed,
  and mobile navigation.

## Out of scope

- Updating the installation automatically.
- Showing GitHub drafts or prereleases.
- Replacing the `/novidades` feed.
