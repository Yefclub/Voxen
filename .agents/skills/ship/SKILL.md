---
name: ship
description: Use quando for entregar uma mudança pelo fluxo completo do repositório ("faz a PR", "shipa isso", "manda pra dev", "abre PR pra essa correção") — branch a partir de dev sincronizada, checklist pre-PR, review independente antes do push, PR, espera robusta de CI e merge.
---

# Ship — branch, review, PR, CI, and merge

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

### 4. Independent review — before the push, always required

Read and run the `review-pr` skill at `.agents/skills/review-pr/SKILL.md` in a
background sub-agent, pointed at the local commit range
(`git diff origin/dev...HEAD`). The reviewer checks the diff, tests, security,
scope, migrations, and specification. It never comments on GitHub, and the
author never self-approves.

Keep the review scope narrow: defects the diff introduces, breakage of existing
behavior, and gaps against what the issue asked for. Adjacent improvements and
pre-existing problems are out of scope — without that bound the reviewer returns
legitimate but peripheral findings and the signal drowns.

If the verdict is `MUDANÇAS NECESSÁRIAS`, fix every blocking finding in the
local branch, re-run only what the fix touched, and review again. Repeat steps 2
to 4 until the review comes back clean. Nothing is pushed during this loop.

Why here and not after CI: a finding caught after the push costs a full runner
cycle, and most of those cycles are spent on intermediate commits nobody would
have merged. A local review needs no push and no runner.

### 5. Push once and open the PR

```bash
git push -u origin <branch>

gh pr create --base dev --head <branch> \
  --title "<English Conventional Commit title>" \
  --body "<detailed English body>"
```

The body uses these English sections: Context, What changed, Technical details,
Test plan, and References. Do not add emoji or AI attribution.

### 6. Monitor CI robustly

Confirm that the rollup belongs to the current head SHA, contains every
required check, has no pending or failed conclusions, and ends with
`mergeStateStatus: CLEAN`. An empty or stale rollup is never success.

Never decide a merge from raw `gh pr checks <num>`: its exit code is `0` only
when everything passed and `8` for "any pending **or** failed" — it does not
tell them apart — and its output can include checks from old cancelled runs.
Use `statusCheckRollup` and wait for completion. See the `ci-status` skill for
the two real failure modes (replication lag / empty rollup, and a push that
never triggers CI) and the background polling loop.

If CI fails, investigate, fix, push, and repeat. Do not merge a red head. CI
catching something the local review could not — a flake, an environment
difference, a gate that only runs on the runner — is the legitimate exception,
not a sign the review was skipped.

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

### 7. Merge

The review already passed in step 4, so a green CI is the whole remaining gate.
If a fix was pushed after CI failed, re-review that fix commit before merging —
the author does not self-approve a correction either.

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
