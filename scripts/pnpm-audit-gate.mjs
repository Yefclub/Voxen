#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { evaluatePnpmAudit } from "./pnpm-audit-gate-lib.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    values.push(value);
  }
  return values;
}

function advisoryLine(advisory) {
  return `${advisory.github_advisory_id} (${advisory.severity}) ${advisory.module_name}: ${advisory.title}`;
}

const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.signal || (result.status !== 0 && result.status !== 1)) {
  throw new Error(
    `pnpm audit did not complete normally (status=${result.status}, signal=${result.signal}).`,
  );
}
if (!result.stdout.trim()) {
  throw new Error(`pnpm audit returned no JSON: ${result.stderr.trim()}`);
}

const report = JSON.parse(result.stdout);
const { blocking, ignored } = evaluatePnpmAudit(report, {
  minimumSeverity: option("--level", "high"),
  allowlist: options("--allow"),
});

for (const advisory of ignored) {
  console.log(`Allowed by documented exception: ${advisoryLine(advisory)}`);
}
if (blocking.length > 0) {
  for (const advisory of blocking) console.error(advisoryLine(advisory));
  process.exitCode = 1;
} else {
  console.log("pnpm audit gate passed.");
}
