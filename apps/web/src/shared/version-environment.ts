export type VersionEnvironment = 'dev' | 'prod';

const DEV_MARKER = '-dev.';

export function isDevVersion(version: string | null | undefined): boolean {
  return typeof version === 'string' && version.includes(DEV_MARKER);
}

export function resolveVersionEnvironment(version: string | null | undefined): VersionEnvironment {
  return isDevVersion(version) ? 'dev' : 'prod';
}
