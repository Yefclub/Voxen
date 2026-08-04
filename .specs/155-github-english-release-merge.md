# Spec 155 — GitHub English-first and clean release merges

## Context

The repository currently presents its main README, contribution guides, issue
forms, and pull-request template in Portuguese. Stable release PRs are titled
`release: vX.Y.Z`, while the default squash configuration copies the PR commit
messages into the merge body. Deployment tools display that full Git message,
which produced a noisy label instead of the intended version-only identifier.

## Glossary

- **Public GitHub surface**: repository description, root community files,
  issue forms, pull-request template, workflow summaries, and release notes.
- **Clean release subject**: the exact string `vX.Y.Z`, with no prefix, PR
  number, generated body, or authorship trailer.
- **Internal product language**: user-facing copy inside Voxen; this remains
  independent from the repository language.

## Requirements

### Ubiquitous

- The system shall use English as the default language for public GitHub
  surfaces and contributor instructions.
- The system shall keep Portuguese documentation discoverable from the main
  README.
- The system shall keep conventional commit types and scopes in English.
- The system shall never add AI attribution or generated-authorship trailers.
- The system shall configure default squash merges with a blank body.

### Event-driven

- When preparing a stable release, the system shall instruct the maintainer to
  create a PR titled exactly `vX.Y.Z`.
- When the owner approves a stable release PR, the agent shall squash it with
  the explicit subject `vX.Y.Z` and an empty body.
- When GitHub renders an issue or pull-request form, the system shall present
  its prompts and validation guidance in English.

### Unwanted behavior

- If a release merge would use the default generated subject or body, then the
  agent shall not merge it until the explicit version-only command is used.
- If a documentation change affects repository governance, then Portuguese
  must not remain described as the canonical GitHub language.

## Acceptance criteria

- [x] `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `SUPPORT.md` are in
      English and link to Portuguese documentation.
- [x] All files under `.github/ISSUE_TEMPLATE/` and the PR template are in
      English.
- [x] Agent and release preparation instructions require a PR title and squash
      subject equal to `vX.Y.Z`, with a blank merge body.
- [x] A deterministic script test prevents the release instructions from
      regressing to `release: vX.Y.Z`.
- [x] Repository metadata is English and GitHub's squash message setting is
      `BLANK`.
- [x] Existing product UI copy and release history are not rewritten.

## Out of scope

- Translating application UI copy.
- Rewriting existing commits, tags, releases, PRs, or issues.
- Translating every historical Portuguese technical document in this PR.

> 2026-08-03: scope approved by the owner as part of the product and repository
> improvement study.
