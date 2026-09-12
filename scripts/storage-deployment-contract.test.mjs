import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("compose forwards all legacy Garage settings to web and worker", async () => {
  const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
  for (const key of [
    "GARAGE_ENDPOINT",
    "GARAGE_ACCESS_KEY",
    "GARAGE_SECRET_KEY",
    "GARAGE_BUCKET",
    "GARAGE_REGION",
    "GARAGE_CREDS_PATH",
  ]) {
    assert.equal(
      (compose.match(new RegExp(`\\n\\s+${key}:`, "g")) ?? []).length,
      2,
      key,
    );
  }
});

test("all production entrypoints reject ephemeral local storage", async () => {
  for (const file of [
    "scripts/easypanel-entrypoint.sh",
    "apps/web/entrypoint.sh",
    "apps/worker/entrypoint.sh",
  ]) {
    const source = await readFile(join(repoRoot, file), "utf8");
    assert.match(source, /\/proc\/self\/mountinfo/, file);
    assert.match(source, /ephemeral|efêmero/, file);
    assert.match(source, /\/app/, file);
  }
});

async function backupFixture({
  failDump = false,
  driver = "local",
  endpoint,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "voxen-backup-test-"));
  const bin = join(root, "bin");
  const backups = join(root, "backups");
  const envFile = join(root, ".env");
  const logFile = join(root, "docker.log");
  await mkdir(bin);
  const storageEnv = [
    `STORAGE_DRIVER=${driver}`,
    endpoint ? `S3_ENDPOINT=${endpoint}` : null,
    "POSTGRES_USER=voxen",
    "POSTGRES_DB=voxen",
    "MASTER_KEY=test-key",
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(envFile, `${storageEnv}\n`);
  await writeFile(logFile, "");
  await writeFile(
    join(bin, "docker"),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'volume inspect voxen_minio_data') exit 0 ;;
  'compose --profile s3 ps --status running -q minio') printf 'minio-container\\n' ;;
  'compose ps --status running --services') printf 'web\\nworker\\n' ;;
  'compose exec -T postgres pg_dump -U voxen voxen')
    if [[ "\${FAIL_DUMP:-0}" = 1 ]]; then exit 17; fi
    printf 'CREATE TABLE safe_backup();\\n'
    ;;
  'compose run --rm --no-deps --entrypoint tar web czf - -C /data/storage .')
    printf 'storage-archive'
    ;;
  'run --rm --volumes-from minio-container:ro alpine tar czf - -C /data .')
    printf 'minio-archive'
    ;;
esac
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [join(repoRoot, "scripts/backup.sh")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DOCKER_LOG: logFile,
      FAIL_DUMP: failDump ? "1" : "0",
      VOXEN_BACKUP_DIR: backups,
      VOXEN_ENV_FILE: envFile,
      VOXEN_BACKUP_DATE: "test-date",
    },
  });
  return { backups, logFile, result };
}

test("backup pauses writers and publishes all artifacts only after success", async () => {
  const fixture = await backupFixture();
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  assert.match(
    gunzipSync(
      await readFile(join(fixture.backups, "db-test-date.sql.gz")),
    ).toString(),
    /safe_backup/,
  );
  assert.equal(
    await readFile(join(fixture.backups, "storage-test-date.tar.gz"), "utf8"),
    "storage-archive",
  );
  const log = await readFile(fixture.logFile, "utf8");
  assert.ok(
    log.indexOf("compose stop web worker") <
      log.indexOf("compose exec -T postgres pg_dump"),
  );
  assert.match(log, /compose start web worker/);
});

test("backup cannot report success or publish archives when pg_dump fails", async () => {
  const fixture = await backupFixture({ failDump: true });
  assert.notEqual(fixture.result.status, 0);
  assert.doesNotMatch(fixture.result.stdout, /Backup complete/);
  const files = await readdir(fixture.backups);
  assert.deepEqual(
    files.filter((file) => !file.startsWith(".")),
    [],
  );
  assert.match(
    await readFile(fixture.logFile, "utf8"),
    /compose start web worker/,
  );
});

test("backup snapshots the active Compose MinIO container", async () => {
  const fixture = await backupFixture({
    driver: "s3",
    endpoint: "http://minio:9000",
  });
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  assert.equal(
    await readFile(join(fixture.backups, "minio-test-date.tar.gz"), "utf8"),
    "minio-archive",
  );
  const log = await readFile(fixture.logFile, "utf8");
  assert.match(log, /compose --profile s3 ps --status running -q minio/);
  assert.match(log, /run --rm --volumes-from minio-container:ro/);
});

test("a stale MinIO volume never disguises external S3 as backed up", async () => {
  const fixture = await backupFixture({
    driver: "s3",
    endpoint: "https://s3.example.com",
  });
  assert.equal(fixture.result.status, 2);
  assert.match(fixture.result.stderr, /external S3 is selected/);
  assert.doesNotMatch(fixture.result.stdout, /Backup complete/);
  assert.deepEqual(await readdir(fixture.backups), []);
  assert.doesNotMatch(
    await readFile(fixture.logFile, "utf8"),
    /volume inspect/,
  );
});
