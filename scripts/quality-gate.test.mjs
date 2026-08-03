import assert from "node:assert/strict";
import test from "node:test";
import {
  collectOversizedFiles,
  compareBaselines,
  compareMetrics,
  countCoverableLines,
  isProductionSource,
  parseJscpdReport,
  parseLcov,
  parsePythonCoverage,
} from "./quality-gate-lib.mjs";

const baseline = {
  schemaVersion: 1,
  coverageMinimum: { web: 70, worker: 80 },
  duplicationMaximum: 2.5,
  fileLineLimit: 500,
  oversizedFileAllowance: { "apps/web/src/legacy.ts": 700 },
};

const metrics = {
  coverage: {
    web: { percent: 70, coveredLines: 70, totalLines: 100 },
    worker: { percent: 81, coveredLines: 81, totalLines: 100 },
  },
  duplication: {
    percent: 2.5,
    duplicatedLines: 25,
    totalLines: 1000,
    clones: 3,
  },
  files: {
    oversized: [{ path: "apps/web/src/legacy.ts", lines: 700 }],
  },
};

test("coverage parsers normalize LCOV and coverage.py JSON", () => {
  const lcov = [
    "SF:src/a.ts",
    "LF:10",
    "LH:7",
    "end_of_record",
    "SF:tests/a.test.ts",
    "LF:5",
    "LH:5",
    "end_of_record",
  ].join("\n");
  assert.deepEqual(parseLcov(lcov), {
    coveredLines: 7,
    totalLines: 10,
    percent: 70,
  });
  assert.deepEqual(
    parsePythonCoverage(
      JSON.stringify({ totals: { covered_lines: 8, num_statements: 10 } }),
    ),
    { coveredLines: 8, totalLines: 10, percent: 80 },
  );
});

test("web coverage fails safe for source files absent from Bun LCOV", () => {
  const lcov = ["SF:src/a.ts", "LF:10", "LH:7", "end_of_record"].join("\n");
  const expected = [
    { path: "src/a.ts", source: "reported" },
    {
      path: "src/unloaded.ts",
      source: "// comment\nconst one = 1;\n\n/* note */\nconst two = 2;\n",
    },
  ];
  assert.equal(countCoverableLines(expected[1].source), 2);
  assert.deepEqual(
    parseLcov(lcov, () => true, expected),
    {
      coveredLines: 7,
      totalLines: 12,
      percent: 58.33,
    },
  );
});

test("duplication parser uses jscpd aggregate evidence", () => {
  const report = {
    statistics: { total: { duplicatedLines: 25, lines: 1000, clones: 3 } },
  };
  assert.deepEqual(parseJscpdReport(JSON.stringify(report)), {
    duplicatedLines: 25,
    totalLines: 1000,
    clones: 3,
    percent: 2.5,
  });
});

test("production source selection excludes tests and generated files", () => {
  assert.equal(isProductionSource("apps/web/src/routes/jobs.ts"), true);
  assert.equal(isProductionSource("apps/worker/src/pipeline.py"), true);
  assert.equal(isProductionSource("apps/extension/popup.css"), true);
  assert.equal(isProductionSource("apps/web/src/routes/jobs.test.ts"), false);
  assert.equal(isProductionSource("apps/worker/tests/test_pipeline.py"), false);
  assert.equal(
    isProductionSource("apps/web/src/prisma-generated/client.ts"),
    false,
  );
});

test("file collector reports only production files above the limit", () => {
  assert.deepEqual(
    collectOversizedFiles(
      [
        { path: "small.ts", source: "one\ntwo\n" },
        { path: "large.ts", source: "one\ntwo\nthree\n" },
      ],
      2,
    ),
    [{ path: "large.ts", lines: 3 }],
  );
});

test("ratchet accepts equality and improvements", () => {
  assert.deepEqual(compareMetrics(metrics, baseline), []);
  const improved = structuredClone(metrics);
  improved.coverage.web.percent = 71;
  improved.duplication.percent = 2.4;
  improved.files.oversized[0].lines = 699;
  assert.deepEqual(compareMetrics(improved, baseline), []);
});

test("ratchet reports coverage, duplication, legacy growth, and new large files", () => {
  const regressed = structuredClone(metrics);
  regressed.coverage.web.percent = 69.99;
  regressed.coverage.worker.percent = 79.99;
  regressed.duplication.percent = 2.51;
  regressed.files.oversized = [
    { path: "apps/web/src/legacy.ts", lines: 701 },
    { path: "apps/web/src/new.ts", lines: 501 },
  ];
  assert.deepEqual(
    compareMetrics(regressed, baseline).map(({ code }) => code),
    [
      "coverage-web",
      "coverage-worker",
      "duplication",
      "oversized-file-growth",
      "new-oversized-file",
    ],
  );
});

test("baseline edits may tighten but never relax the target branch", () => {
  const tighter = structuredClone(baseline);
  tighter.coverageMinimum.web = 71;
  tighter.duplicationMaximum = 2.4;
  tighter.oversizedFileAllowance["apps/web/src/legacy.ts"] = 699;
  assert.deepEqual(compareBaselines(tighter, baseline), []);

  const relaxed = structuredClone(baseline);
  relaxed.coverageMinimum.web = 69;
  relaxed.duplicationMaximum = 2.6;
  relaxed.fileLineLimit = 600;
  relaxed.oversizedFileAllowance["apps/web/src/legacy.ts"] = 701;
  relaxed.oversizedFileAllowance["apps/web/src/new.ts"] = 550;
  assert.deepEqual(compareBaselines(relaxed, baseline), [
    "coverageMinimum.web cannot decrease.",
    "duplicationMaximum cannot increase.",
    "fileLineLimit cannot increase.",
    "oversizedFileAllowance.apps/web/src/legacy.ts cannot increase.",
    "oversizedFileAllowance.apps/web/src/new.ts cannot admit new legacy debt.",
  ]);
});

test("malformed evidence fails closed", () => {
  assert.throws(() =>
    parseLcov("SF:tests/only.test.ts\nLF:2\nLH:2\nend_of_record"),
  );
  assert.throws(() => parsePythonCoverage("{}"));
  assert.throws(() => parseJscpdReport("{}"));
});
