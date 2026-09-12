# Spec 199 — Agent rule mirror guard

## Context

The repository carries the same agent rules twice. `.claude/` is what Claude
Code loads; `.agents/` is what Codex loads. `AGENTS.md` declares the second a
mirror of the first, identical except that `.claude/` path references become
`.agents/`, and excludes `.claude/settings.local.json` as local configuration.

Nothing enforced that. The trees drifted silently in #765, which added `name`
and `description` frontmatter to every skill under `.claude/` and left the
mirror untouched. It surfaced only when a reviewer compared the trees by hand
during #772, one pull request later. The failure mode is invisible in ordinary
review because neither tree looks wrong on its own — the defect exists only in
the relationship between them, and no diff shows a relationship.

The consequence is not cosmetic. In #772 the two trees would have taught
opposite orders for the same workflow: `.claude/skills/ship` said review before
pushing, `.agents/skills/ship` still said review after CI. An agent's behaviour
would then depend on which harness the contributor happened to run.

A second, sharper risk appears once repair is automated. Mirroring is a copy,
and `.gitignore` ignores three paths under `.claude/` — `settings.local.json`,
`scheduled_tasks.lock`, and `worktrees/` — while the corresponding paths under
`.agents/` are not all ignored. A naive copy promotes local state into a
versioned tree. The parallel-worktree flow in `CLAUDE.md` puts full repository
checkouts under `.claude/worktrees/`, `.env` files included.

## Glossary

- **Source tree**: `.claude/`, the tree contributors edit.
- **Mirror**: `.agents/`, generated from the source tree.
- **Path rewrite**: the mandated `.claude/` → `.agents/` substitution applied to
  mirrored file contents.
- **Drift**: any difference between the mirror and the rewritten source tree.
- **Ignored path**: a path excluded from mirroring, whether by the static deny
  set or by `git check-ignore`.

## Requirements

### Ubiquitous

- The guard shall treat `.claude/` as the source of truth and `.agents/` as
  generated output.
- The guard shall consider a mirrored file correct when its bytes equal the
  source file with the path rewrite applied.
- The guard shall exclude ignored paths from both trees.
- The guard shall exclude symbolic links from both trees.

### Event-driven

- When a pull request changes a mirrored file in only one tree, the continuous
  integration check shall fail.
- When the guard runs with no repair flag, it shall report every missing,
  diverged, and extra path, and exit non-zero if any exist.
- When the guard runs with the repair flag, it shall write the mirror from the
  source tree and remove mirrored files whose source counterpart is gone.
- When a mirrored file is not valid UTF-8, the guard shall copy its bytes
  unchanged rather than apply the path rewrite.

### State-driven

- While the two trees differ only by line-ending convention, the guard shall
  consider them equal.
- While `git check-ignore` is unavailable, the guard shall still exclude paths
  matched by its static deny set.

### Unwanted behavior

- If the source tree is absent from the resolved root, then the guard shall
  fail with an explicit error instead of reporting a match.
- If a path is ignored by `.gitignore`, then the guard shall neither compare nor
  copy it.
- If a mirrored path exists as a symbolic link, then repair shall replace the
  link rather than write through it.

## Acceptance criteria

- [ ] Editing a file under `.claude/` without updating `.agents/` fails
      continuous integration.
- [ ] Repair regenerates the mirror so that a subsequent check passes, and is
      idempotent.
- [ ] Repair removes a mirrored file whose source counterpart was deleted.
- [ ] A file matching `.gitignore` under `.claude/` is neither compared nor
      copied, including a full worktree checkout containing `.env`.
- [ ] The static deny set alone excludes local state when git cannot answer.
- [ ] A non-UTF-8 file survives repair byte for byte, and a corrupted mirrored
      binary is reported as diverged rather than clean.
- [ ] A symbolic link on either side is excluded rather than followed.
- [ ] The report states how many paths were excluded.
- [ ] Running the command from a subdirectory reports the repository state
      rather than an empty match.
- [ ] A missing source tree raises an error.
- [ ] Line-ending differences between the trees do not register as drift.

## Out of scope

- Removing the mirror in favour of a single tree, or replacing mirrored files
  with pointers. That changes how Codex resolves rules and is a separate
  decision.
- Mirroring anything outside `.claude/`. `AGENTS.md` at the repository root is a
  pointer to `CLAUDE.md`, not a generated copy of it.
- Automatic repair in continuous integration. The guard reports; a human or an
  agent runs the repair and commits the result, so the mirror change is visible
  in review.

## Risks and open decisions

- **The path rewrite is textual and unconditional.** A mirrored file cannot
  deliberately keep a literal `.claude/` reference. No file needs that today;
  the escape hatch is to exclude the file in the library rather than hand-edit
  the mirror, which repair would revert.
- **The guard runs as a test, not as a dedicated workflow job.** `Test TS
  (apps/web)` is already one of the nine required checks, and
  `version-dev.yml` asserts that count in two places which
  `scripts/github-surface-contract.test.mjs` covers. A new job would either not
  be required, or would drag branch protection and those assertions along. The
  cost is that the failure is attributed to the test job rather than to a
  self-describing check name.
- **The static deny set can drift from `.gitignore`,** which is the mistake this
  spec exists to avoid repeating. `git check-ignore` is the primary filter and
  the static set is only the fallback for when git cannot answer, so drift
  degrades the fallback rather than the guard.
