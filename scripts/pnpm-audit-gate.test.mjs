import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePnpmAudit } from "./pnpm-audit-gate-lib.mjs";

const report = {
  advisories: {
    one: {
      github_advisory_id: "GHSA-allowed-high",
      severity: "high",
      module_name: "router",
      title: "High finding outside the used feature surface",
    },
    two: {
      github_advisory_id: "GHSA-blocking-critical",
      severity: "critical",
      module_name: "runtime",
      title: "Critical finding",
    },
    three: {
      github_advisory_id: "GHSA-below-threshold",
      severity: "moderate",
      module_name: "tooling",
      title: "Moderate finding",
    },
  },
};

test("pnpm audit gate allows only the exact documented advisory", () => {
  const result = evaluatePnpmAudit(report, {
    minimumSeverity: "high",
    allowlist: ["GHSA-allowed-high"],
  });
  assert.deepEqual(
    result.ignored.map((advisory) => advisory.github_advisory_id),
    ["GHSA-allowed-high"],
  );
  assert.deepEqual(
    result.blocking.map((advisory) => advisory.github_advisory_id),
    ["GHSA-blocking-critical"],
  );
});

test("pnpm audit gate blocks a high advisory without an exception", () => {
  const result = evaluatePnpmAudit(report, { minimumSeverity: "high" });
  assert.deepEqual(
    result.blocking.map((advisory) => advisory.github_advisory_id),
    ["GHSA-allowed-high", "GHSA-blocking-critical"],
  );
});

test("pnpm audit gate fails closed for malformed evidence", () => {
  assert.throws(() => evaluatePnpmAudit(null));
  assert.throws(() => evaluatePnpmAudit({}));
  assert.throws(() =>
    evaluatePnpmAudit({ advisories: { broken: { severity: "high" } } }),
  );
});
