#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "migration-gate-postgres";
import {
  analyzeMigrationHistory,
  missingCustomGinIndexes,
  unexpectedDriftStatements,
  validateGateDatabaseUrls,
} from "./prisma-migration-gate-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps/web");
const SCHEMA = join(ROOT, "prisma/schema.prisma");
const MIGRATIONS = join(ROOT, "prisma/migrations");
const DRIFT_ALLOWLIST = join(ROOT, "prisma/migration-drift-allowlist.json");
const OUTPUT = resolve(
  ROOT,
  process.env.MIGRATION_GATE_OUTPUT ?? "prisma-migration-gate/output",
);
const databaseUrl = process.env.MIGRATION_GATE_DATABASE_URL ?? "";
const shadowDatabaseUrl = process.env.MIGRATION_GATE_SHADOW_DATABASE_URL ?? "";
const baseRef = process.env.MIGRATION_GATE_BASE_REF ?? "";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function nulList(source) {
  return source.split("\0").filter(Boolean);
}

function currentMigrations() {
  return new Map(
    readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const path = `prisma/migrations/${entry.name}/migration.sql`;
        const absolute = join(ROOT, path);
        return [
          path,
          existsSync(absolute) ? readFileSync(absolute, "utf8") : "",
        ];
      }),
  );
}

function baseMigrations(ref) {
  if (!ref) return null;
  git(["rev-parse", "--verify", ref]);
  const paths = nulList(
    git(["ls-tree", "-r", "-z", "--name-only", ref, "--", "prisma/migrations"]),
  );
  return new Map(
    paths
      .filter((path) => path.endsWith("/migration.sql"))
      .map((path) => [path, git(["show", `${ref}:${path}`])]),
  );
}

function schemaChangedAt(ref) {
  if (!ref) return false;
  const result = spawnSync(
    "git",
    ["diff", "--quiet", ref, "--", "prisma/schema.prisma"],
    { cwd: ROOT },
  );
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(
    "Unable to compare prisma/schema.prisma with the target branch.",
  );
}

function redact(source) {
  let redacted = source;
  for (const secret of [databaseUrl, shadowDatabaseUrl]) {
    if (secret)
      redacted = redacted.replaceAll(secret, "[REDACTED_DATABASE_URL]");
  }
  return redacted;
}

function runPrisma(name, args, env) {
  const result = spawnSync("pnpm", ["exec", "prisma", ...args], {
    cwd: WEB,
    env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const log = redact(
    `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  );
  mkdirSync(join(OUTPUT, "logs"), { recursive: true });
  writeFileSync(join(OUTPUT, "logs", `${name}.log`), log);
  return {
    name,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
    log: `logs/${name}.log`,
  };
}

async function catalogIndexMethods() {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
    max_lifetime: 60,
    prepare: false,
  });
  try {
    const rows = await sql`
      SELECT relation.relname AS name, method.amname AS method
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         JOIN pg_catalog.pg_am AS method
           ON method.oid = relation.relam
        WHERE relation.relkind = 'i'
          AND namespace.nspname = current_schema()
        ORDER BY relation.relname
    `;
    return new Map(rows.map(({ name, method }) => [name, method]));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function driftStage(env) {
  const allowlist = JSON.parse(readFileSync(DRIFT_ALLOWLIST, "utf8"));
  if (allowlist?.schemaVersion !== 1) {
    throw new Error("prisma/migration-drift-allowlist.json is invalid.");
  }
  const indexMethods = await catalogIndexMethods();
  const missingIndexes = missingCustomGinIndexes(
    indexMethods,
    allowlist.ignoredIndexes,
  );
  if (missingIndexes.length > 0) {
    throw new Error(
      `Drift allowlist entries are not live GIN indexes in the replayed database: ${missingIndexes.join(", ")}.`,
    );
  }
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      `--from-migrations=${MIGRATIONS}`,
      `--to-schema-datamodel=${SCHEMA}`,
      `--shadow-database-url=${shadowDatabaseUrl}`,
      "--script",
    ],
    {
      cwd: WEB,
      env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const log = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  mkdirSync(join(OUTPUT, "logs"), { recursive: true });
  const logPath = join(OUTPUT, "logs/drift.log");
  writeFileSync(logPath, log);
  if (result.status !== 0) {
    return {
      name: "drift",
      status: "FAIL",
      exitCode: result.status ?? 1,
      log: "logs/drift.log",
    };
  }

  const unexpected = unexpectedDriftStatements(log, allowlist.ignoredIndexes);
  if (unexpected.length > 0) {
    appendFileSync(
      logPath,
      `\nUnexpected declarative drift:\n${unexpected.join("\n")}\n`,
    );
    return {
      name: "drift",
      status: "FAIL",
      exitCode: 2,
      log: "logs/drift.log",
    };
  }
  return {
    name: "drift",
    status: "PASS",
    exitCode: 0,
    log: "logs/drift.log",
    ignoredIndexes: allowlist.ignoredIndexes,
  };
}

async function captureStage(name, operation) {
  try {
    return await operation();
  } catch (error) {
    mkdirSync(join(OUTPUT, "logs"), { recursive: true });
    const log = `logs/${name}.log`;
    writeFileSync(
      join(OUTPUT, log),
      `${redact(error instanceof Error ? error.message : String(error))}\n`,
    );
    return { name, status: "FAIL", exitCode: 1, log };
  }
}

function formatStage(env) {
  const directory = mkdtempSync(join(tmpdir(), "voxen-prisma-format-"));
  const copy = join(directory, "schema.prisma");
  try {
    copyFileSync(SCHEMA, copy);
    const stage = runPrisma("format", ["format", `--schema=${copy}`], env);
    if (stage.status === "PASS") {
      const original = readFileSync(SCHEMA, "utf8");
      const formatted = readFileSync(copy, "utf8");
      if (original !== formatted) {
        stage.status = "FAIL";
        stage.exitCode = 1;
        appendFileSync(
          join(OUTPUT, stage.log),
          "\nprisma/schema.prisma is not canonically formatted.\n",
        );
      }
    }
    return stage;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function renderSummary(staticResult, stages, urlFailures) {
  const failures = [
    ...staticResult.failures.map(({ message }) => message),
    ...urlFailures.map(({ message }) => message),
    ...stages
      .filter(({ status }) => status === "FAIL")
      .map(({ name, log }) => `${name} failed; inspect ${log}.`),
  ];
  const lines = [
    "# Prisma Migration Gate",
    "",
    `**Result: ${failures.length === 0 ? "PASS" : "FAIL"}**`,
    "",
    `Migration files: ${staticResult.migrations}; additions against target: ${staticResult.additions.length}.`,
    "",
    "| Stage | Status | Evidence |",
    "| --- | :---: | --- |",
    `| History contract | ${staticResult.failures.length === 0 ? "PASS" : "FAIL"} | results.json |`,
    `| Database URL safety | ${urlFailures.length === 0 ? "PASS" : "FAIL"} | results.json |`,
    ...stages.map(
      ({ name, status, log }) => `| ${name} | ${status} | ${log} |`,
    ),
  ];
  if (failures.length > 0) {
    lines.push("", "## Failures", "", ...failures.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  let staticResult;
  try {
    staticResult = analyzeMigrationHistory({
      currentMigrations: currentMigrations(),
      baseMigrations: baseMigrations(baseRef),
      schemaChanged: schemaChangedAt(baseRef),
      migrationLock: readFileSync(
        join(MIGRATIONS, "migration_lock.toml"),
        "utf8",
      ),
    });
  } catch (error) {
    staticResult = {
      migrations: 0,
      additions: [],
      failures: [
        {
          code: "history-collector",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const urlFailures = validateGateDatabaseUrls(databaseUrl, shadowDatabaseUrl);
  const stages = [];
  if (urlFailures.length === 0) {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    stages.push(
      await captureStage("validate", () =>
        runPrisma("validate", ["validate", `--schema=${SCHEMA}`], env),
      ),
      await captureStage("format", () => formatStage(env)),
      await captureStage("deploy", () =>
        runPrisma("deploy", ["migrate", "deploy", `--schema=${SCHEMA}`], env),
      ),
      await captureStage("status", () =>
        runPrisma("status", ["migrate", "status", `--schema=${SCHEMA}`], env),
      ),
      await captureStage("drift", () => driftStage(env)),
    );
  }

  const report = {
    schemaVersion: 1,
    baseRef: baseRef || null,
    history: staticResult,
    databaseUrlSafety: {
      status: urlFailures.length === 0 ? "PASS" : "FAIL",
      failures: urlFailures,
    },
    stages,
  };
  const summary = renderSummary(staticResult, stages, urlFailures);
  writeFileSync(
    join(OUTPUT, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(OUTPUT, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(summary);

  if (
    staticResult.failures.length > 0 ||
    urlFailures.length > 0 ||
    stages.some(({ status }) => status === "FAIL")
  ) {
    process.exitCode = 1;
  }
}

await main();
