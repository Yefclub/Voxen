const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

export function evaluatePnpmAudit(
  report,
  { minimumSeverity = "high", allowlist = [] } = {},
) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("pnpm audit returned an invalid report.");
  }
  if (
    !report.advisories ||
    typeof report.advisories !== "object" ||
    Array.isArray(report.advisories)
  ) {
    throw new Error("pnpm audit report is missing advisories.");
  }
  const threshold = SEVERITY_RANK[minimumSeverity];
  if (threshold === undefined) {
    throw new Error(`Unknown audit severity: ${minimumSeverity}`);
  }

  const allowed = new Set(allowlist);
  const blocking = [];
  const ignored = [];
  for (const advisory of Object.values(report.advisories)) {
    const severity = String(advisory?.severity ?? "").toLowerCase();
    const rank = SEVERITY_RANK[severity];
    const id = advisory?.github_advisory_id;
    if (rank === undefined) {
      throw new Error("pnpm audit returned a malformed advisory.");
    }
    if (rank < threshold) continue;
    if (typeof id !== "string" || !id) {
      throw new Error(
        "A blocking pnpm advisory is missing its GHSA identifier.",
      );
    }
    if (allowed.has(id)) ignored.push(advisory);
    else blocking.push(advisory);
  }
  return { blocking, ignored };
}
