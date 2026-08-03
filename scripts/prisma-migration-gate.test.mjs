import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMigrationHistory,
  missingCustomGinIndexes,
  unexpectedDriftStatements,
  validateGateDatabaseUrls,
} from "./prisma-migration-gate-lib.mjs";

const lock = 'provider = "postgresql"\n';
const oldPath = "prisma/migrations/20260801000000_old/migration.sql";
const newPath = "prisma/migrations/20260804000000_new/migration.sql";
const base = new Map([[oldPath, "SELECT 1;\n"]]);

test("migration history accepts an ordered addition", () => {
  const result = analyzeMigrationHistory({
    currentMigrations: new Map([...base, [newPath, "SELECT 2;\n"]]),
    baseMigrations: base,
    schemaChanged: true,
    migrationLock: lock,
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.additions, [newPath]);
});

test("integrated migrations are immutable", () => {
  const edited = analyzeMigrationHistory({
    currentMigrations: new Map([[oldPath, "SELECT 9;\n"]]),
    baseMigrations: base,
    migrationLock: lock,
  });
  assert.deepEqual(
    edited.failures.map(({ code }) => code),
    ["immutable-migration-edited"],
  );

  const deleted = analyzeMigrationHistory({
    currentMigrations: new Map(),
    baseMigrations: base,
    migrationLock: lock,
  });
  assert.deepEqual(
    deleted.failures.map(({ code }) => code),
    ["immutable-migration-deleted"],
  );
});

test("schema changes require a new migration", () => {
  const result = analyzeMigrationHistory({
    currentMigrations: base,
    baseMigrations: base,
    schemaChanged: true,
    migrationLock: lock,
  });
  assert.deepEqual(
    result.failures.map(({ code }) => code),
    ["schema-without-migration"],
  );
});

test("invalid, duplicate, empty, and out-of-order migrations fail", () => {
  const current = new Map([
    ...base,
    ["prisma/migrations/not-valid/migration.sql", "SELECT 1;"],
    ["prisma/migrations/20260801000000_duplicate/migration.sql", ""],
    ["prisma/migrations/20260701000000_late/migration.sql", "SELECT 1;"],
  ]);
  const result = analyzeMigrationHistory({
    currentMigrations: current,
    baseMigrations: base,
    migrationLock: lock,
  });
  assert.deepEqual(
    result.failures.map(({ code }) => code).sort(),
    [
      "duplicate-migration-timestamp",
      "empty-migration",
      "invalid-migration-path",
      "out-of-order-migration",
      "out-of-order-migration",
    ].sort(),
  );
});

test("migration lock must preserve the PostgreSQL provider", () => {
  const result = analyzeMigrationHistory({
    currentMigrations: base,
    migrationLock: 'provider = "mysql"\n',
  });
  assert.equal(result.failures[0].code, "migration-lock");
});

test("database URLs are restricted to dedicated loopback databases", () => {
  assert.deepEqual(
    validateGateDatabaseUrls(
      "postgresql://voxen:dev@127.0.0.1:5432/voxen_migration_gate",
      "postgresql://voxen:dev@localhost:5432/voxen_shadow",
    ),
    [],
  );
  assert.deepEqual(
    validateGateDatabaseUrls(
      "postgresql://voxen:dev@db.internal:5432/voxen_migration_gate",
      "postgresql://voxen:dev@localhost:5432/production",
    ).map(({ code }) => code),
    ["unsafe-database-url", "unsafe-database-url"],
  );
  assert.deepEqual(
    validateGateDatabaseUrls(
      "postgresql://voxen:dev@localhost:5432/shared_migration_gate",
      "postgresql://voxen:dev@localhost:5432/shared_migration_gate",
    ).map(({ code }) => code),
    ["unsafe-database-url", "shared-database-url"],
  );
});

test("drift allowlist suppresses only exact custom index removals", () => {
  assert.deepEqual(
    unexpectedDriftStatements(
      '-- DropIndex\nDROP INDEX "Note_searchVector_idx";\n',
      ["Note_searchVector_idx"],
    ),
    [],
  );
  assert.deepEqual(
    unexpectedDriftStatements(
      'DROP INDEX "Note_searchVector_idx";\nALTER TABLE "User" DROP COLUMN "email";\n',
      ["Note_searchVector_idx"],
    ),
    ['ALTER TABLE "User" DROP COLUMN "email";'],
  );
  assert.throws(() => unexpectedDriftStatements("", ['bad"; DROP TABLE']));
  assert.deepEqual(
    missingCustomGinIndexes(
      'CREATE INDEX IF NOT EXISTS "Note_searchVector_idx" ON "Note" USING GIN ("searchVector");',
      ["Note_searchVector_idx"],
    ),
    [],
  );
  assert.deepEqual(
    missingCustomGinIndexes(
      'CREATE INDEX "ordinary_idx" ON "Note" ("updatedAt");\nCREATE INDEX "custom_idx" ON "Note" USING GIN ("searchVector");',
      ["ordinary_idx"],
    ),
    ["ordinary_idx"],
  );
});
