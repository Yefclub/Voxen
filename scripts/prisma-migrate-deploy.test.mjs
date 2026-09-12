import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = path.join(root, "scripts", "prisma-migrate-deploy.sh");
const migration = "20260808130000_saved_media_library";

function fixture(mode) {
  const directory = mkdtempSync(path.join(tmpdir(), "voxen-prisma-recovery-"));
  const repairDirectory = path.join(directory, "repairs");
  const fakePrisma = path.join(directory, "prisma");
  const calls = path.join(directory, "calls");
  const state = path.join(directory, "state");
  mkdirSync(repairDirectory);
  writeFileSync(path.join(repairDirectory, `${migration}.sql`), "SELECT 1;\n");
  writeFileSync(
    fakePrisma,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "${calls}"
if [ "$1 $2" = "migrate deploy" ]; then
  count=0
  [ ! -f "${state}" ] || count="$(cat "${state}")"
  count=$((count + 1))
  printf '%s' "$count" > "${state}"
  if [ "$count" = 1 ] && [ "${mode}" = known ]; then
    echo 'Error: P3009' >&2
    echo 'The \`${migration}\` migration started previously failed' >&2
    exit 1
  fi
  if [ "$count" = 1 ] && [ "${mode}" = unknown ]; then
    echo 'Error: P3009' >&2
    echo 'The \`20990101000000_unknown\` migration started previously failed' >&2
    exit 42
  fi
  echo 'All migrations have been successfully applied.'
fi
`,
  );
  chmodSync(fakePrisma, 0o755);
  return { calls, directory, fakePrisma, repairDirectory };
}

function runFixture(mode) {
  const current = fixture(mode);
  const result = spawnSync("sh", [deployScript, "/tmp/schema.prisma"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PRISMA_BIN: current.fakePrisma,
      PRISMA_REPAIR_DIR: current.repairDirectory,
    },
  });
  const calls = readFileSync(current.calls, "utf8").trim().split("\n");
  return { ...current, calls, result };
}

test("repairs only the known failed migration and resumes deploy", () => {
  const { calls, result } = runFixture("known");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 4);
  assert.equal(calls[0], "migrate deploy --schema=/tmp/schema.prisma");
  assert.match(
    calls[1],
    new RegExp(`^db execute --file=.*${migration}\\.sql `),
  );
  assert.equal(
    calls[2],
    `migrate resolve --applied ${migration} --schema=/tmp/schema.prisma`,
  );
  assert.equal(calls[3], "migrate deploy --schema=/tmp/schema.prisma");
  assert.match(
    result.stdout,
    /known migration repaired; resuming migrate deploy/,
  );
});

test("keeps unknown migration failures fail-closed", () => {
  const { calls, result } = runFixture("unknown");
  assert.equal(result.status, 42);
  assert.deepEqual(calls, ["migrate deploy --schema=/tmp/schema.prisma"]);
  assert.doesNotMatch(result.stdout, /repairing the known partial migration/);
});

test("does not run recovery when the first deploy succeeds", () => {
  const { calls, result } = runFixture("success");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, ["migrate deploy --schema=/tmp/schema.prisma"]);
  assert.match(result.stdout, /All migrations have been successfully applied/);
});
