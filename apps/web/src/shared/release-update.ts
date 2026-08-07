import { resolveVersionEnvironment, type VersionEnvironment } from './version-environment';

export interface ParsedVoxenVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export interface ReleaseUpdateStatus {
  available: boolean;
  currentVersion: string;
  environment: VersionEnvironment;
  latestVersion: string | null;
  latestTag: string | null;
  releaseUrl: string | null;
  checkedAt: string;
}

const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVoxenVersion(value: string | null | undefined): ParsedVoxenVersion | null {
  if (!value) return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function isStableReleaseNewer(current: string, latest: string): boolean {
  const currentVersion = parseVoxenVersion(current);
  const latestVersion = parseVoxenVersion(latest);
  if (!currentVersion || !latestVersion || latestVersion.prerelease) return false;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (latestVersion[key] > currentVersion[key]) return true;
    if (latestVersion[key] < currentVersion[key]) return false;
  }

  return currentVersion.prerelease !== null;
}

export function buildReleaseUpdateStatus(input: {
  currentVersion: string;
  latestTag?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  checkedAt?: Date;
}): ReleaseUpdateStatus {
  const latest = input.latestTag?.trim() ?? null;
  const validStable =
    !input.draft &&
    !input.prerelease &&
    latest !== null &&
    parseVoxenVersion(latest)?.prerelease === null;
  const available = Boolean(validStable && isStableReleaseNewer(input.currentVersion, latest));
  const parsedLatest = validStable && latest ? parseVoxenVersion(latest) : null;
  const latestVersion = parsedLatest
    ? `${parsedLatest.major}.${parsedLatest.minor}.${parsedLatest.patch}`
    : null;
  const latestTag = latestVersion ? `v${latestVersion}` : null;

  return {
    available,
    currentVersion: input.currentVersion,
    environment: resolveVersionEnvironment(input.currentVersion),
    latestVersion,
    latestTag,
    releaseUrl: latestTag
      ? `https://github.com/Yefclub/Voxen/releases/tag/${encodeURIComponent(latestTag)}`
      : null,
    checkedAt: (input.checkedAt ?? new Date()).toISOString(),
  };
}
