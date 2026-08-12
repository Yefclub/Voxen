---
name: release
description: Use quando for preparar uma release estável ("prepara a release", "sobe pra main", "bump de versão", "fecha a vX.Y.Z") — coleta tudo que entrou em dev desde a tag anterior e abre a PR dev→main com título, label e mensagem de merge corretos.
---

# Release — prepare a stable release PR (dev → main)

Prepare a stable release by collecting everything merged into `dev` since the
previous tag.

## Inputs

- Release label: `release:patch`, `release:minor`, or `release:major`
- Optional context for the pull-request body

## Flow

### 1. Identify the scope

```bash
git fetch origin --tags
git log origin/main --oneline -1
gh pr list --state merged --base dev --search "merged:>=YYYY-MM-DD" \
  --json number,title,labels,mergedAt,author
git diff origin/main...origin/dev --stat
```

Group changes into features, fixes, improvements, infrastructure, and other
maintenance. Check for open PRs targeting `dev` that appear release-critical.

### 2. Prepare the version and curated notes

Run the deterministic preparation command from a fresh release branch:

```bash
pnpm release:prepare patch # or minor/major
```

Review `changelog/RELEASE.md`, `releases.json`, both package versions, and
`CHANGELOG.md`. Stable notes must be user-facing and grouped by product theme.

### 3. Validate

Run the full local validation required by `CLAUDE.md`, including the release
script tests. Confirm that the prepared version is stable SemVer and matches the
selected label.

### 4. Create the release PR

The PR title must be the exact version tag, without a `release:` prefix:

```bash
gh pr create --base main --head release/vX.Y.Z \
  --title "vX.Y.Z" \
  --label "release:patch|minor|major" \
  --body-file /tmp/voxen-release-pr-body.md
```

The body is in English and includes a user-facing summary, migrations or
operational warnings, validation evidence, and the curated release notes.

### 5. Stop for owner approval

Never merge a release PR without explicit owner approval. Keep monitoring CI
and run the independent review, but report the ready PR and wait.

When the owner later approves the merge, use an explicit version-only subject
and blank body. Do not use GitHub's default squash subject:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch \
  --subject "vX.Y.Z" \
  --body ""
```

This exact command prevents PR numbers, commit lists, and generated trailers
from appearing in the stable release commit or deployment label.

After publication, synchronize `main` back into `dev` through a normal PR.
