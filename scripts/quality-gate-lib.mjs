const METRIC_PRECISION = 2;
const EPSILON = 10 ** -(METRIC_PRECISION + 1);

export function roundMetric(value) {
  return Number(Number(value).toFixed(METRIC_PRECISION));
}

function percentage(covered, total) {
  return roundMetric(total === 0 ? 100 : (covered / total) * 100);
}

export function countCoverableLines(source) {
  let inBlockComment = false;
  let total = 0;
  for (const rawLine of source.replace(/\r\n/g, "\n").split("\n")) {
    let line = rawLine.trim();
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      inBlockComment = false;
      line = line.slice(end + 2).trim();
    }
    while (line.startsWith("/*")) {
      const end = line.indexOf("*/", 2);
      if (end === -1) {
        inBlockComment = true;
        line = "";
        break;
      }
      line = line.slice(end + 2).trim();
    }
    if (line && !line.startsWith("//")) total += 1;
  }
  return total;
}

export function parseLcov(
  source,
  include = (path) => path.startsWith("src/"),
  expectedFiles = [],
) {
  let coveredLines = 0;
  let totalLines = 0;
  const reported = new Set();
  for (const record of source.split("end_of_record")) {
    const path = record.match(/^SF:(.+)$/m)?.[1]?.replaceAll("\\", "/");
    if (!path || !include(path)) continue;
    reported.add(path);
    const found = Number(record.match(/^LF:(\d+)$/m)?.[1] ?? 0);
    const hit = Number(record.match(/^LH:(\d+)$/m)?.[1] ?? 0);
    if (!Number.isFinite(found) || !Number.isFinite(hit) || hit > found) {
      throw new Error(`Invalid LCOV line totals for ${path}.`);
    }
    totalLines += found;
    coveredLines += hit;
  }
  for (const file of expectedFiles) {
    if (!reported.has(file.path))
      totalLines += countCoverableLines(file.source);
  }
  if (totalLines === 0)
    throw new Error("Web LCOV contains no production source lines.");
  return {
    coveredLines,
    totalLines,
    percent: percentage(coveredLines, totalLines),
  };
}

export function parsePythonCoverage(source) {
  const report = JSON.parse(source);
  const coveredLines = Number(report?.totals?.covered_lines);
  const totalLines = Number(report?.totals?.num_statements);
  if (
    !Number.isFinite(coveredLines) ||
    !Number.isFinite(totalLines) ||
    totalLines <= 0
  ) {
    throw new Error("Worker coverage JSON has invalid totals.");
  }
  return {
    coveredLines,
    totalLines,
    percent: percentage(coveredLines, totalLines),
  };
}

export function parseJscpdReport(source) {
  const report = JSON.parse(source);
  const total = report?.statistics?.total;
  const duplicatedLines = Number(total?.duplicatedLines);
  const totalLines = Number(total?.lines);
  const clones = Number(total?.clones);
  if (
    !Number.isFinite(duplicatedLines) ||
    !Number.isFinite(totalLines) ||
    totalLines <= 0 ||
    !Number.isFinite(clones)
  ) {
    throw new Error("jscpd JSON has invalid totals.");
  }
  return {
    duplicatedLines,
    totalLines,
    clones,
    percent: percentage(duplicatedLines, totalLines),
  };
}

export function isProductionSource(path) {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    /\.(?:test|spec)\.[^.]+$/.test(normalized) ||
    normalized.includes("/prisma-generated/") ||
    normalized.includes("/dist/") ||
    normalized.includes("/public/extension/")
  ) {
    return false;
  }
  if (normalized.startsWith("apps/worker/src/"))
    return normalized.endsWith(".py");
  if (
    normalized.startsWith("apps/web/src/") ||
    normalized.startsWith("apps/extension/")
  ) {
    return (
      /\.(?:[cm]?[jt]sx?|css)$/.test(normalized) &&
      !normalized.endsWith(".d.ts")
    );
  }
  return false;
}

export function countSourceLines(source) {
  if (source.length === 0) return 0;
  return source.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length;
}

export function collectOversizedFiles(files, lineLimit) {
  return files
    .map(({ path, source }) => ({ path, lines: countSourceLines(source) }))
    .filter(({ lines }) => lines > lineLimit)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function requireNumber(value, label) {
  if (!Number.isFinite(value))
    throw new Error(`Baseline field ${label} must be numeric.`);
}

export function validateBaseline(baseline) {
  if (!baseline || baseline.schemaVersion !== 1) {
    throw new Error("Quality baseline must use schemaVersion 1.");
  }
  requireNumber(baseline.coverageMinimum?.web, "coverageMinimum.web");
  requireNumber(baseline.coverageMinimum?.worker, "coverageMinimum.worker");
  requireNumber(baseline.duplicationMaximum, "duplicationMaximum");
  requireNumber(baseline.fileLineLimit, "fileLineLimit");
  if (
    !baseline.oversizedFileAllowance ||
    Array.isArray(baseline.oversizedFileAllowance) ||
    typeof baseline.oversizedFileAllowance !== "object"
  ) {
    throw new Error("Baseline field oversizedFileAllowance must be an object.");
  }
  for (const [path, allowance] of Object.entries(
    baseline.oversizedFileAllowance,
  )) {
    requireNumber(allowance, `oversizedFileAllowance.${path}`);
  }
  return baseline;
}

function worseMinimum(current, minimum) {
  return current + EPSILON < minimum;
}

function worseMaximum(current, maximum) {
  return current - EPSILON > maximum;
}

export function compareMetrics(metrics, rawBaseline) {
  const baseline = validateBaseline(rawBaseline);
  const failures = [];
  for (const runtime of ["web", "worker"]) {
    const current = metrics.coverage[runtime].percent;
    const allowed = baseline.coverageMinimum[runtime];
    if (worseMinimum(current, allowed)) {
      failures.push({
        code: `coverage-${runtime}`,
        message: `${runtime} coverage is ${current}% but the minimum is ${allowed}%.`,
      });
    }
  }
  if (worseMaximum(metrics.duplication.percent, baseline.duplicationMaximum)) {
    failures.push({
      code: "duplication",
      message: `duplication is ${metrics.duplication.percent}% but the maximum is ${baseline.duplicationMaximum}%.`,
    });
  }
  for (const file of metrics.files.oversized) {
    const allowance = baseline.oversizedFileAllowance[file.path];
    if (allowance === undefined) {
      failures.push({
        code: "new-oversized-file",
        path: file.path,
        message: `${file.path} has ${file.lines} lines and exceeds the ${baseline.fileLineLimit}-line limit.`,
      });
    } else if (file.lines > allowance) {
      failures.push({
        code: "oversized-file-growth",
        path: file.path,
        message: `${file.path} grew to ${file.lines} lines; its legacy allowance is ${allowance}.`,
      });
    }
  }
  return failures;
}

export function compareBaselines(candidateRaw, targetRaw) {
  const candidate = validateBaseline(candidateRaw);
  const target = validateBaseline(targetRaw);
  const failures = [];
  for (const runtime of ["web", "worker"]) {
    if (
      worseMinimum(
        candidate.coverageMinimum[runtime],
        target.coverageMinimum[runtime],
      )
    ) {
      failures.push(`coverageMinimum.${runtime} cannot decrease.`);
    }
  }
  if (worseMaximum(candidate.duplicationMaximum, target.duplicationMaximum)) {
    failures.push("duplicationMaximum cannot increase.");
  }
  if (candidate.fileLineLimit > target.fileLineLimit) {
    failures.push("fileLineLimit cannot increase.");
  }
  for (const [path, allowance] of Object.entries(
    candidate.oversizedFileAllowance,
  )) {
    const targetAllowance = target.oversizedFileAllowance[path];
    if (targetAllowance === undefined) {
      if (allowance > target.fileLineLimit) {
        failures.push(
          `oversizedFileAllowance.${path} cannot admit new legacy debt.`,
        );
      }
    } else if (allowance > targetAllowance) {
      failures.push(`oversizedFileAllowance.${path} cannot increase.`);
    }
  }
  return failures;
}

export function renderSummary(
  metrics,
  baseline,
  failures,
  baselineFailures = [],
) {
  const status = (failed) => (failed ? "FAIL" : "PASS");
  const webFailed = failures.some(({ code }) => code === "coverage-web");
  const workerFailed = failures.some(({ code }) => code === "coverage-worker");
  const duplicationFailed = failures.some(({ code }) => code === "duplication");
  const fileFailures = failures.filter(({ code }) =>
    code.includes("oversized"),
  );
  const lines = [
    "# Quality Gate",
    "",
    `**Result: ${failures.length + baselineFailures.length === 0 ? "PASS" : "FAIL"}**`,
    "",
    "| Metric | Current | Allowed | Status |",
    "| --- | ---: | ---: | :---: |",
    `| Web line coverage | ${metrics.coverage.web.percent}% | >= ${baseline.coverageMinimum.web}% | ${status(webFailed)} |`,
    `| Worker line coverage | ${metrics.coverage.worker.percent}% | >= ${baseline.coverageMinimum.worker}% | ${status(workerFailed)} |`,
    `| Duplicated lines | ${metrics.duplication.percent}% | <= ${baseline.duplicationMaximum}% | ${status(duplicationFailed)} |`,
    `| Oversized source files | ${metrics.files.oversized.length} | no new/growing debt | ${status(fileFailures.length > 0)} |`,
    "",
    `Scanned ${metrics.files.scanned} production files. Detailed evidence is in the \`quality-gate-report\` artifact.`,
  ];
  if (failures.length > 0 || baselineFailures.length > 0) {
    lines.push("", "## Regressions", "");
    for (const failure of failures) lines.push(`- ${failure.message}`);
    for (const failure of baselineFailures)
      lines.push(`- Baseline relaxation: ${failure}`);
  }
  return `${lines.join("\n")}\n`;
}
