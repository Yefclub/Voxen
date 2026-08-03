#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectOversizedFiles,
  compareBaselines,
  compareMetrics,
  isProductionSource,
  parseJscpdReport,
  parseLcov,
  parsePythonCoverage,
  renderSummary,
  validateBaseline,
} from "./quality-gate-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value.`);
  return value;
}

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function trackedProductionFiles() {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(isProductionSource);
  return paths.map((path) => ({ path, source: read(path) }));
}

function baselineAtRef(ref, path) {
  execFileSync("git", ["rev-parse", "--verify", ref], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    const source = execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(source);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 128
    )
      return null;
    throw error;
  }
}

function writeReport(outputDir, name, content) {
  const path = resolve(ROOT, outputDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function main() {
  const webCoveragePath = option(
    "--web-coverage",
    "quality-gate/input/web/lcov.info",
  );
  const workerCoveragePath = option(
    "--worker-coverage",
    "quality-gate/input/worker/coverage.json",
  );
  const duplicationPath = option(
    "--duplication-report",
    "quality-gate/output/jscpd-report.json",
  );
  const baselinePath = option("--baseline", "quality-gate/baseline.json");
  const outputDir = option("--output", "quality-gate/output");
  const baseRef = option(
    "--base-ref",
    process.env.QUALITY_GATE_BASELINE_REF ?? "",
  );
  const baseline = validateBaseline(JSON.parse(read(baselinePath)));
  const files = trackedProductionFiles();
  const webCoverageFiles = files
    .filter(
      ({ path }) => path.startsWith("apps/web/src/") && !path.endsWith(".css"),
    )
    .map(({ path, source }) => ({
      path: path.slice("apps/web/".length),
      source,
    }));
  const metrics = {
    schemaVersion: 1,
    coverage: {
      web: parseLcov(
        read(webCoveragePath),
        (path) => path.startsWith("src/"),
        webCoverageFiles,
      ),
      worker: parsePythonCoverage(read(workerCoveragePath)),
    },
    duplication: parseJscpdReport(read(duplicationPath)),
    files: {
      lineLimit: baseline.fileLineLimit,
      scanned: files.length,
      oversized: collectOversizedFiles(files, baseline.fileLineLimit),
    },
  };
  const failures = compareMetrics(metrics, baseline);
  const targetBaseline = baseRef ? baselineAtRef(baseRef, baselinePath) : null;
  const baselineFailures = targetBaseline
    ? compareBaselines(baseline, targetBaseline)
    : [];
  const summary = renderSummary(metrics, baseline, failures, baselineFailures);
  writeReport(
    outputDir,
    "metrics.json",
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  writeReport(outputDir, "summary.md", summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(summary);
  if (failures.length > 0 || baselineFailures.length > 0) process.exitCode = 1;
}

function failClosed(error) {
  const outputDir = option("--output", "quality-gate/output");
  const message = error instanceof Error ? error.message : String(error);
  const summary = `# Quality Gate\n\n**Result: FAIL**\n\n- Collector error: ${message}\n`;
  writeReport(
    outputDir,
    "metrics.json",
    `${JSON.stringify({ schemaVersion: 1, error: message }, null, 2)}\n`,
  );
  writeReport(outputDir, "summary.md", summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.error(summary);
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  failClosed(error);
}
