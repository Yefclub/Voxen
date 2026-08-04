# Spec 159 — Prisma migration validation gate

## Context

The existing web and worker test jobs run `prisma migrate deploy` against a
fresh PostgreSQL service. That proves the current SQL can execute, but Prisma
documents that `migrate deploy` does not detect schema drift and does not use a
shadow database. It also cannot prevent an already-integrated migration from
being edited or deleted in a pull request.

Voxen needs a dedicated, required migration check that treats the committed
migration history as the source of truth, replays it independently, compares
its declarative end state with `schema.prisma`, and leaves stable diagnostics
for a coding agent.

## Requirements

### Ubiquitous

- The gate shall validate the Prisma schema, canonical formatting, migration
  history structure, full replay, applied status and history-to-schema drift.
- Migration directories shall use a unique `YYYYMMDDHHMMSS_slug` name and
  contain a non-empty `migration.sql`.
- The migration lock shall remain committed for the PostgreSQL provider.
- Drift exceptions shall be limited to exact custom index names that Prisma's
  data model cannot represent.
- Databases used by the local runner shall be explicit, dedicated localhost
  databases rather than the application's generic `DATABASE_URL`.
- Every stage shall write a machine-readable result and a concise Markdown
  diagnosis.

### Event-driven

- When a pull request changes `schema.prisma`, it shall add at least one new
  migration after the latest migration on the target branch.
- When a migration exists on the target branch, the pull request shall preserve
  its path and contents byte-for-byte.
- When CI evaluates migrations, it shall apply the entire history to an empty
  PostgreSQL database and verify `prisma migrate status` afterward.
- When replay succeeds, CI shall use a separate shadow database and
  `prisma migrate diff --exit-code` to compare migrations with the Prisma data
  model.
- When any stage fails, the job shall still upload the diagnostic artifact.

### Unwanted behavior

- If an integrated migration is edited, renamed or deleted, the static gate
  shall fail before deployment.
- If the schema changes without a new migration, or a migration is empty,
  malformed, duplicated or older than the target history, the gate shall fail
  with the affected path.
- If validation, formatting, replay, status or drift comparison fails, the
  runner shall fail closed and retain the exact stage log with connection
  strings redacted.
- The runner shall refuse non-loopback database hosts, identical target/shadow
  databases, or database names that do not identify dedicated gate databases.
- The workflow shall not reset, migrate or introspect a production database.

## Agent handoff contract

The `prisma-migration-gate-report` artifact shall contain:

- `results.json`: stage status, failure codes and affected migrations;
- `summary.md`: the first document an agent should read;
- `logs/*.log`: redacted Prisma output for every dynamic stage.

Shipping instructions shall require agents to download this artifact, correct
the migration/schema rather than editing historical migrations, and continue
monitoring the same pull request.

## Acceptance criteria

- [x] Static tests cover valid additions, immutable-history edits/deletions,
      schema changes without migrations, invalid names, duplicates, empty SQL
      and out-of-order additions.
- [x] The runner refuses unsafe database URLs and always writes diagnostics.
- [x] A clean PostgreSQL instance replays all migrations and reports no
      declarative drift against `schema.prisma`.
- [x] CI publishes the report on success and failure under a dedicated check.
- [x] The version bot waits for the new required context by exact name.
- [x] Local format, lint, typecheck, tests and production build pass.
- [x] The pull request has green CI and an independent review.

## Out of scope

- Applying migrations to staging or production from pull-request CI.
- Automatically rewriting existing migration SQL.
- Detecting drift inside PostgreSQL objects Prisma cannot represent, such as
  trigger bodies and full-text GIN index definitions.
- Replacing deployment-time `prisma migrate deploy`.
- Automatically approving destructive schema changes.

## References

- <https://docs.prisma.io/docs/cli/migrate/deploy>
- <https://docs.prisma.io/docs/cli/migrate/diff>
- <https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories>

> 2026-08-03: implementation approved by the owner as part of the repository
> CI and agent-quality improvement program.
