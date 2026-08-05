# Changelog

Voxen release notes are assembled from **one file per PR**, committed with the
change. Each product PR adds `changelog/unreleased/<slug>.md` describing what
changed for an end user.

When the PR merges into `dev`, the `version-dev` workflow consumes the files,
stamps the version (`X.Y.Z-dev.<timestamp>`) and date, moves the content into
`releases.json` (the **What's new** page), and removes the source file.

CI fails a product PR that does not add a release note. Infrastructure,
documentation, and CI-only changes are exempt.

## Bilingual format

Release notes use English as the canonical repository language and include a
curated Brazilian Portuguese translation for the product UI. The HTML marker is
only a delimiter for the pipeline; it is not rendered to end users.

```markdown
---
tipo: feat # feat | fix | perf | ui | infra | security | chore
titulo_en: Clear, user-facing English title
titulo_pt_br: Título claro em português voltado à pessoa usuária
---

Detailed English Markdown body — what changed, where it appears, and why.

<!-- pt-BR -->

Corpo detalhado em Markdown em português — o que mudou, onde aparece e por quê.
```

Entries created before this format remain supported and display their original
text until they receive a curated translation.

## Types

| type       | use                        |
| ---------- | -------------------------- |
| `feat`     | visible product feature    |
| `fix`      | bug fix                    |
| `perf`     | performance improvement    |
| `ui`       | visual or UX change        |
| `infra`    | infrastructure or pipeline |
| `security` | security improvement       |
| `chore`    | maintenance or internal    |

## Production release (`dev` → `main`)

In the release PR, write one curated `changelog/RELEASE.md` using the same
bilingual format:

```markdown
---
titulo_en: Voxen 0.11 — Library and versioning
titulo_pt_br: Voxen 0.11 — Biblioteca e versionamento
---

## Library

Compact cards, folders, and AI-assisted organization…

## Versioning

Development builds now show X.Y.Z-dev.timestamp…

<!-- pt-BR -->

## Biblioteca

Cards compactos, pastas e organização com IA…

## Versionamento

Builds de desenvolvimento agora exibem X.Y.Z-dev.timestamp…
```
