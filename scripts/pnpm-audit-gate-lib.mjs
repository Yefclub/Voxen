const SEVERITY_RANK = {
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
  if (!report.advisories || typeof report.advisories !== "object") {
    throw new Error("pnpm audit report is missing advisories.");
  }
  const threshold = SEVERITY_RANK[minimumSeverity];
  if (!threshold) throw new Error(`Unknown audit severity: ${minimumSeverity}`);

  const allowed = new Set(allowlist);
  const blocking = [];
  const ignored = [];
  for (const advisory of Object.values(report.advisories)) {
    const severity = String(advisory?.severity ?? "").toLowerCase();
    const rank = SEVERITY_RANK[severity];
    const id = advisory?.github_advisory_id;
    if (!rank || typeof id !== "string" || !id) {
      throw new Error("pnpm audit returned a malformed advisory.");
    }
    if (rank < threshold) continue;
    if (allowed.has(id)) ignored.push(advisory);
    else blocking.push(advisory);
  }
  return { blocking, ignored };
}
