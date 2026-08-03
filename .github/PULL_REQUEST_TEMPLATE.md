# Pull request title (English, no emoji or AI attribution)

## Context

Why does this change exist? Which problem does it solve?

## What changed

- Change 1
- Change 2

## Technical details

Explain decisions, trade-offs, and complex behavior. List critical files.

## Test plan

- [ ] `make format-check` passes
- [ ] `make lint` passes
- [ ] `make typecheck` passes
- [ ] `make test` passes
- [ ] `docker compose build` passes
- [ ] Easypanel Dockerfile passes `Docker build (apps + Easypanel)`
- [ ] Specification added or updated under `.specs/` when applicable
- [ ] Prisma migration added when the schema changed
- [ ] Manual scenarios verified: describe them here

## References

- Issue: #N (when applicable)
- Spec: `.specs/NNN-slug.md` (when applicable)
- ADR: `docs/DECISIONS.md` ADR-N (when applicable)
