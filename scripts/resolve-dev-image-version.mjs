const prereleaseSemver =
  /^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const stableSemver = /^[0-9]+\.[0-9]+\.[0-9]+$/;

const [packageVersion, baseVersion, buildStamp] = process.argv.slice(2);

if (prereleaseSemver.test(packageVersion ?? "")) {
  process.stdout.write(packageVersion);
  process.exit(0);
}

if (!stableSemver.test(packageVersion ?? "")) {
  throw new Error(`Invalid package version: ${packageVersion ?? "(missing)"}`);
}

if (!stableSemver.test(baseVersion ?? "")) {
  throw new Error(`Invalid base version: ${baseVersion ?? "(missing)"}`);
}

if (!/^[0-9]+$/.test(buildStamp ?? "")) {
  throw new Error(`Invalid build stamp: ${buildStamp ?? "(missing)"}`);
}

const nextVersion = baseVersion.split(".").map(Number);
nextVersion[2] += 1;
process.stdout.write(`${nextVersion.join(".")}-dev.${buildStamp}`);
