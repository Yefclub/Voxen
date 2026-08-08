import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "migration-gate-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = path.join(root, "prisma", "schema.prisma");
const repairDirectory = path.join(root, "prisma", "repairs");
const repairSql = path.join(
  repairDirectory,
  "20260808130000_saved_media_library.sql",
);
const deployScript = path.join(root, "scripts", "prisma-migrate-deploy.sh");
const prisma = path.join(root, "apps", "web", "node_modules", ".bin", "prisma");
const migration = "20260808130000_saved_media_library";
const databaseUrl = process.env.DATABASE_URL ?? "";
const canRun = Boolean(databaseUrl) && existsSync(prisma);

function run(command, args, testUrl, extraEnv = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      ...extraEnv,
    },
    maxBuffer: 20 * 1024 * 1024,
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function assertSuccess(result, context) {
  assert.equal(result.status, 0, `${context}\n${output(result)}`);
}

function databaseName(suffix) {
  return `voxen_saved_media_recovery_${suffix}_${process.pid}_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
}

function databaseWithName(source, name) {
  const parsed = new URL(source);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function withDatabase(admin, name, callback) {
  assert.match(name, /^[a-z0-9_]+$/);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const testUrl = databaseWithName(databaseUrl, name);
  const sql = postgres(testUrl, { max: 1, onnotice() {} });
  try {
    await callback({ sql, testUrl });
  } finally {
    await sql.end({ timeout: 5 });
    await admin`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${name}
        AND pid <> pg_backend_pid()
    `;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
  }
}

function migrate(testUrl) {
  const result = run(
    prisma,
    ["migrate", "deploy", `--schema=${schema}`],
    testUrl,
  );
  assertSuccess(result, "Unable to prepare the migration recovery database");
}

function executeRepair(testUrl) {
  return run(
    prisma,
    ["db", "execute", `--file=${repairSql}`, `--schema=${schema}`],
    testUrl,
  );
}

function recover(testUrl) {
  return run("sh", [deployScript, schema], testUrl, {
    PRISMA_BIN: prisma,
    PRISMA_REPAIR_DIR: repairDirectory,
  });
}

async function assertRecoveredCatalog(sql) {
  const [catalog] = await sql`
    SELECT
      to_regclass('"SavedMedia"') IS NOT NULL AS table_exists,
      (
        SELECT COUNT(*)::INTEGER
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'SavedMedia'
      ) AS column_count,
      (
        SELECT COUNT(*)::INTEGER
        FROM pg_constraint
        WHERE (conname = 'SavedMedia_pkey' AND conrelid = '"SavedMedia"'::regclass)
           OR (conname = 'SavedMedia_userId_fkey' AND conrelid = '"SavedMedia"'::regclass)
           OR (conname = 'SavedMedia_transcriptId_fkey' AND conrelid = '"SavedMedia"'::regclass)
           OR (conname = 'Job_savedMediaId_fkey' AND conrelid = '"Job"'::regclass)
      ) AS constraint_count,
      (
        SELECT COUNT(*)::INTEGER
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = ANY(ARRAY[
            'SavedMedia_transcriptId_key',
            'SavedMedia_userId_canonicalUrl_key',
            'SavedMedia_userId_createdAt_idx',
            'SavedMedia_userId_status_createdAt_idx',
            'Job_userId_savedMediaId_status_idx'
          ])
      ) AS index_count
  `;
  assert.equal(catalog.table_exists, true);
  assert.equal(catalog.column_count, 20);
  assert.equal(catalog.constraint_count, 4);
  assert.equal(catalog.index_count, 5);
}

test(
  "recovers empty and partial SavedMedia states idempotently on PostgreSQL",
  { skip: !canRun, timeout: 180_000 },
  async () => {
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    try {
      await withDatabase(admin, databaseName("valid"), async ({ sql, testUrl }) => {
        migrate(testUrl);

        await sql`
          UPDATE "_prisma_migrations"
          SET finished_at = NULL,
              applied_steps_count = 0,
              logs = 'simulated interrupted migration',
              rolled_back_at = NULL
          WHERE migration_name = ${migration}
        `;
        await sql.unsafe('DROP TABLE "SavedMedia" CASCADE');
        await sql.unsafe(
          'ALTER TABLE "Job" DROP COLUMN "savedMediaId" CASCADE',
        );

        const emptyRecovery = recover(testUrl);
        assertSuccess(emptyRecovery, "Empty-state recovery failed");
        assert.match(
          output(emptyRecovery),
          /known migration repaired; resuming migrate deploy/,
        );
        await assertRecoveredCatalog(sql);

        await sql.unsafe(
          'ALTER TABLE "Job" DROP CONSTRAINT "Job_savedMediaId_fkey"',
        );
        await sql.unsafe('DROP INDEX "SavedMedia_userId_createdAt_idx"');
        await sql.unsafe('ALTER TABLE "SavedMedia" DROP COLUMN "readyAt"');

        const partialRecovery = executeRepair(testUrl);
        assertSuccess(partialRecovery, "Partial-state repair failed");
        await assertRecoveredCatalog(sql);

        const secondExecution = executeRepair(testUrl);
        assertSuccess(secondExecution, "Idempotent repair execution failed");
        await assertRecoveredCatalog(sql);
      });
    } finally {
      await admin.end({ timeout: 5 });
    }
  },
);

test(
  "rejects an incompatible homonymous index without resolving the migration",
  { skip: !canRun, timeout: 180_000 },
  async () => {
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    try {
      await withDatabase(
        admin,
        databaseName("incompatible"),
        async ({ sql, testUrl }) => {
          migrate(testUrl);
          await sql.unsafe('DROP INDEX "SavedMedia_userId_createdAt_idx"');
          await sql.unsafe(
            'CREATE INDEX "SavedMedia_userId_createdAt_idx" ON "SavedMedia"("title")',
          );
          await sql`
            UPDATE "_prisma_migrations"
            SET finished_at = NULL,
                applied_steps_count = 0,
                logs = 'simulated incompatible migration',
                rolled_back_at = NULL
            WHERE migration_name = ${migration}
          `;

          const result = recover(testUrl);
          assert.notEqual(result.status, 0, output(result));
          assert.match(
            output(result),
            /missing or incompatible indexes: \{SavedMedia_userId_createdAt_idx\}/,
          );
          assert.doesNotMatch(
            output(result),
            /known migration repaired; resuming migrate deploy/,
          );

          const rows = await sql`
            SELECT finished_at, rolled_back_at
            FROM "_prisma_migrations"
            WHERE migration_name = ${migration}
          `;
          assert.equal(rows.length, 1);
          assert.equal(rows[0].finished_at, null);
          assert.equal(rows[0].rolled_back_at, null);
        },
      );
    } finally {
      await admin.end({ timeout: 5 });
    }
  },
);
