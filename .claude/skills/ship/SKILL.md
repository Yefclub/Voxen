---
name: ship
description: Use quando for entregar uma mudança pelo fluxo completo do repositório ("faz a PR", "shipa isso", "manda pra dev", "abre PR pra essa correção") — branch a partir de dev sincronizada, checklist pre-PR, PR, espera robusta de CI, review independente e merge.
---

# Ship — branch, PR, CI, review, and merge

Use this flow to deliver one focused change through the complete repository
workflow.

## Inputs

- Required change description, used to name the branch and pull request
- Merge intent from the owner; normal PRs merge autonomously when the project
  rules authorize it, while stable releases always require explicit approval

## Flow

### 1. Prepare a fresh branch

```bash
git status --short
git branch --show-current
git fetch origin
git checkout dev
git pull --ff-only origin dev
git checkout -b <type>/<descriptive-name>
```

Use `feat/`, `fix/`, `chore/`, or `refactor/` according to the change. Never
branch from another feature or a stale local `dev`.

### 2. Commit only scoped files

```bash
git diff --stat
git status --short
git add <file1> <file2> ...
git commit -m "<type>(<scope>): <concise English description>"
```

Do not use `git add -A`. Never include environment files, credentials, personal
files, unrelated work, AI attribution, or generated authorship trailers.

### 3. Pre-PR checklist (MANDATORY)

Run every item before pushing. A red item is a stop, not a warning.

0. Branch was created from a synchronized `dev` (step 1)
1. `make lint` — eslint, prettier, and ruff clean
2. `make typecheck` — tsc and mypy clean
3. `make test` — bun test and pytest passing
4. Specification in `.specs/` created or updated when the change is non-trivial
5. Migrations in sync: if `prisma/schema.prisma` changed, a migration exists
6. `docker compose build` — the real build works; it catches errors tsc and mypy
   do not

### 4. Push and open the PR

```bash
git push -u origin <branch>

gh pr create --base dev --head <branch> \
  --title "<English Conventional Commit title>" \
  --body "<detailed English body>"
```

The body uses these English sections: Context, What changed, Technical details,
Test plan, and References. Do not add emoji or AI attribution.

### 5. Monitor CI robustly

Confirm that the rollup belongs to the current head SHA, contains every
required check, has no pending or failed conclusions, and ends with
`mergeStateStatus: CLEAN`. An empty or stale rollup is never success.

Never decide a merge from raw `gh pr checks <num>`: its exit code is `0` only
when everything passed and `8` for "any pending **or** failed" — it does not
tell them apart — and its output can include checks from old cancelled runs.
Use `statusCheckRollup` and wait for completion. See the `ci-status` skill for
the two real failure modes (replication lag / empty rollup, and a push that
never triggers CI) and the background polling loop.

If CI fails, investigate, fix, push, and repeat. Do not review or merge a red
head.

When `Quality Gate` fails, download the `quality-gate-report` artifact from the
failed workflow run. Read `summary.md` and `metrics.json`; use
`jscpd-report.json` for duplicate locations and the raw coverage reports for
untested lines. Address every regression on the same branch, push, and resume
monitoring. Never relax `quality-gate/baseline.json` to make a regression pass.

When `Prisma migration gate` fails, download the
`prisma-migration-gate-report` artifact. Read `summary.md`, then `results.json`
and the referenced redacted stage log. Add or correct a new ordered migration;
never edit, rename, or delete a migration that already exists on the target
branch.

### 6. Independent review — always required

After CI is green, read and run the `review-pr` skill at
`.claude/skills/review-pr/SKILL.md` in a background sub-agent. The reviewer
checks the diff, tests, security, scope, migrations, and specification without
commenting on GitHub.

If the verdict is `MUDANÇAS NECESSÁRIAS`, fix every blocking finding and repeat
CI and review on the new head. If the verdict is `APROVADO`, continue.

### 7. Merge

For an authorized normal PR:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

Stable release PRs (`dev` → `main`) are a special case: always wait for explicit
owner approval, then preserve a version-only Git message:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch \
  --subject "vX.Y.Z" \
  --body ""
```

### 8. Return to updated dev

```bash
git fetch origin --prune
git checkout dev
git pull --ff-only origin dev
```

Perform the post-merge runtime rebuild required by `CLAUDE.md`, unless the PR
is documentation-only.

## Final output

Report the PR link, current head, CI result, review verdict, merge result, and
post-merge validation. Never declare success from an incomplete or stale check.
