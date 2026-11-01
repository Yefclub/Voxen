import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { runDoctor } from "./agent-doctor.mjs";

const root = resolve(import.meta.dirname, "..");

test("doctor separates declared, effective, and observed without claiming success", () => {
  const report = runDoctor();
  assert.equal(report.version, 1);
  assert.ok(report.declared);
  assert.equal(report.effectiveLoaded, "unverified");
  assert.equal(report.observedExecution, "unverified");
  assert.ok(!("success" in report) && !("passed" in report));
});

test("doctor output contains no secrets", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/agent-doctor.mjs", "--json"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.doesNotMatch(output, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(output, /Bearer\s+[A-Za-z0-9._~+/-]{8,}/i);
  assert.doesNotMatch(output, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(output, /MASTER_KEY|BETTER_AUTH_SECRET/);
  const parsed = JSON.parse(output);
  assert.equal(parsed.effectiveLoaded, "unverified");
  assert.equal(parsed.observedExecution, "unverified");
});

test("doctor strict passes on the current tree", () => {
  execFileSync(process.execPath, ["scripts/agent-doctor.mjs", "--strict"], {
    cwd: root,
    stdio: "pipe",
  });
});
