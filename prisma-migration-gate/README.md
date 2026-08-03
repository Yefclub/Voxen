# Prisma Migration Gate

The runner combines repository-history checks with a disposable PostgreSQL
replay. It deliberately reads `MIGRATION_GATE_DATABASE_URL` and
`MIGRATION_GATE_SHADOW_DATABASE_URL` instead of the application's generic
database variable, and rejects non-loopback or ambiguously named databases.

CI uploads `prisma-migration-gate-report` on success and failure. Read
`summary.md` first, then `results.json`, followed by the referenced stage log.
Fix the new migration or schema mismatch; never edit, rename or remove a
migration already present on the target branch.

`prisma/migration-drift-allowlist.json` contains only the names of custom GIN
indexes that the Prisma data model cannot express. The gate verifies each entry
against the access method in the replayed PostgreSQL catalog; it does not infer
the final state from SQL text. It does not suppress column, constraint, table,
enum or ordinary index drift.

The dynamic check requires two empty PostgreSQL databases whose names end in
`migration_gate` and `shadow`, respectively:

```bash
MIGRATION_GATE_DATABASE_URL=postgresql://voxen:dev@localhost:5432/voxen_migration_gate \
MIGRATION_GATE_SHADOW_DATABASE_URL=postgresql://voxen:dev@localhost:5432/voxen_shadow \
MIGRATION_GATE_BASE_REF=origin/dev \
pnpm migration:check
```

The report is written under `prisma-migration-gate/output/` and is ignored by
Git and Docker.
