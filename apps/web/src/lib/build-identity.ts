// Versão da build — fonte canônica em ordem de prioridade:
//   1. env VOXEN_VERSION (release.yml injeta da tag git; Makefile injeta
//      via `git describe --tags --always --dirty` no dev local)
//   2. package.json quando já contém uma prerelease (o version-dev é canônico)
//   3. Easypanel source deploy de uma versão estável: package next-patch +
//      DEPLOY_TIMESTAMP (`X.Y.Z-dev.<unix_epoch_seconds>`) quando há GIT_SHA
//   4. package.json (fallback se build foi feito sem injeção)
// Tag git é a verdade no Voxen — package.json fica como fallback estável.
async function loadAppVersion(): Promise<string> {
  if (process.env.VOXEN_VERSION) return process.env.VOXEN_VERSION;
  try {
    const pkg = await Bun.file(new URL('../../package.json', import.meta.url)).json();
    const packageVersion = typeof pkg.version === 'string' ? pkg.version : '0.1.0';
    return (
      formatDevVersionFromDeploy(
        packageVersion,
        process.env.DEPLOY_TIMESTAMP,
        process.env.VOXEN_GIT_SHA || process.env.GIT_SHA,
      ) ?? packageVersion
    );
  } catch {
    return '0.1.0';
  }
}
export const VOXEN_VERSION = await loadAppVersion();
export const VOXEN_GIT_SHA = process.env.VOXEN_GIT_SHA || process.env.GIT_SHA || '';
export const VOXEN_BUILT_AT =
  process.env.VOXEN_BUILT_AT ||
  deployTimestampToIso(process.env.DEPLOY_TIMESTAMP) ||
  new Date().toISOString();
export function formatDevVersionFromDeploy(
  packageVersion: string,
  deployTimestamp?: string,
  gitSha?: string,
): string | null {
  // Uma versão produzida pelo workflow version-dev precisa coincidir
  // literalmente com releases.json. Reescrevê-la no startup criaria uma
  // versão sintética sem notas correspondentes.
  if (packageVersion.includes('-')) return null;
  const stamp = deployTimestampToUnixSeconds(deployTimestamp);
  if (!stamp || !gitSha) return null;
  const base = packageVersion.split('-', 1)[0] ?? packageVersion;
  const parts = base.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  const [major, minor, patch] = parts as [number, number, number];
  return `${major}.${minor}.${patch + 1}-dev.${stamp}`;
}

function deployTimestampToUnixSeconds(value?: string): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  const seconds = numeric > 9_999_999_999 ? Math.floor(numeric / 1000) : numeric;
  return String(seconds);
}

function deployTimestampToIso(value?: string): string | null {
  const seconds = deployTimestampToUnixSeconds(value);
  if (!seconds) return null;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
