import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "resolve-dev-package-version.mjs",
);

function resolve(currentVersion, stableVersion, buildStamp = "1785864000") {
  return execFileSync(
    process.execPath,
    [script, currentVersion, stableVersion, buildStamp],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

test("moves dev to the next patch when its core equals the stable release", () => {
  assert.equal(
    resolve("0.13.1-dev.1785862977", "0.13.1"),
    "0.13.2-dev.1785864000",
  );
  assert.equal(
    resolve("0.12.9-dev.1785862977", "0.13.1"),
    "0.13.2-dev.1785864000",
  );
  assert.equal(resolve("0.14.0", "0.14.0"), "0.14.1-dev.1785864000");
});

test("refreshes the timestamp without lowering a dev core already ahead of stable", () => {
  assert.equal(
    resolve("0.13.2-dev.1785862977", "0.13.1"),
    "0.13.2-dev.1785864000",
  );
  assert.equal(resolve("0.14.0-rc.1", "0.13.1"), "0.14.0-dev.1785864000");
});

test("refuses malformed inputs instead of publishing an ambiguous version", () => {
  assert.throws(() => resolve("0.13", "0.13.1"), /Invalid current version/);
  assert.throws(
    () => resolve("0.13.1", "0.13.1-dev.1"),
    /Invalid stable version/,
  );
  assert.throws(
    () => resolve("0.13.1", "0.13.1", "stamp"),
    /Invalid build stamp/,
  );
});
