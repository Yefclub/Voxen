import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("chat archive fails closed without DATABASE_URL", () => {
  const result = spawnSync("bash", [join("scripts", "export-chat-archive.sh"), "/tmp/voxen-archive-nope"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL is not set/);
});

test("chat archive covers every retired conversational table", async () => {
  const [{ readFile }] = [await import("node:fs/promises")];
  const source = await readFile(resolve(repoRoot, "scripts/export-chat-archive.sh"), "utf8");
  for (const table of [
    "ChatMessage",
    "ChatTurn",
    "ChatApproval",
    "ChatCompactionLease",
    "ChatStreamLease",
    "Conversation",
    "CostEvent",
  ]) {
    assert.ok(source.includes(`"${table}"`), `archive must dump ${table}`);
  }
});
