const prereleaseSemver =
  /^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const stableSemver = /^[0-9]+\.[0-9]+\.[0-9]+$/;

const [outputKind, packageVersion, baseVersion, buildStamp] =
  process.argv.slice(2);

if (outputKind !== "version" && outputKind !== "docker-tag") {
  throw new Error(`Invalid output kind: ${outputKind ?? "(missing)"}`);
}

let version;

if (prereleaseSemver.test(packageVersion ?? "")) {
  version = packageVersion;
} else {
  if (!stableSemver.test(packageVersion ?? "")) {
    throw new Error(
      `Invalid package version: ${packageVersion ?? "(missing)"}`,
    );
  }

  if (!stableSemver.test(baseVersion ?? "")) {
    throw new Error(`Invalid base version: ${baseVersion ?? "(missing)"}`);
  }

  if (!/^[0-9]+$/.test(buildStamp ?? "")) {
    throw new Error(`Invalid build stamp: ${buildStamp ?? "(missing)"}`);
  }

  const nextVersion = baseVersion.split(".").map(Number);
  nextVersion[2] += 1;
  version = `${nextVersion.join(".")}-dev.${buildStamp}`;
}

process.stdout.write(
  outputKind === "docker-tag" ? version.replaceAll("+", "_") : version,
);
