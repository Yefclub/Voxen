const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const stableVersionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const [currentVersion, stableVersion, buildStamp] = process.argv.slice(2);

function parseVersion(value, pattern, label) {
  const match = pattern.exec(value ?? "");
  if (!match) throw new Error(`Invalid ${label}: ${value ?? "(missing)"}`);
  return match.slice(1, 4).map(Number);
}

if (!/^[0-9]+$/.test(buildStamp ?? "")) {
  throw new Error(`Invalid build stamp: ${buildStamp ?? "(missing)"}`);
}

const current = parseVersion(currentVersion, versionPattern, "current version");
const stable = parseVersion(
  stableVersion,
  stableVersionPattern,
  "stable version",
);
const comparison = current.findIndex((part, index) => part !== stable[index]);
const currentIsAhead =
  comparison >= 0 && current[comparison] > stable[comparison];
const next = currentIsAhead ? current : [stable[0], stable[1], stable[2] + 1];

process.stdout.write(`${next.join(".")}-dev.${buildStamp}`);
