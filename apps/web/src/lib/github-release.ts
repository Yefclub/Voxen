import { buildReleaseUpdateStatus, type ReleaseUpdateStatus } from '../shared/release-update';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/Yefclub/Voxen/releases/latest';
const CACHE_TTL_MS = 30 * 60 * 1000;

interface GitHubLatestRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

interface ReleaseCache {
  etag: string | null;
  expiresAt: number;
  release: GitHubLatestRelease | null;
}

let cache: ReleaseCache = { etag: null, expiresAt: 0, release: null };

function statusFromCache(appVersion: string, checkedAt = new Date()): ReleaseUpdateStatus {
  return buildReleaseUpdateStatus({
    currentVersion: appVersion,
    latestTag: typeof cache.release?.tag_name === 'string' ? cache.release.tag_name : null,
    draft: cache.release?.draft === true,
    prerelease: cache.release?.prerelease === true,
    checkedAt,
  });
}

export async function getGitHubReleaseUpdate(
  appVersion: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<ReleaseUpdateStatus> {
  if (cache.expiresAt > now.getTime()) return statusFromCache(appVersion, now);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Yefclub-Voxen-release-check',
  };
  if (cache.etag) headers['If-None-Match'] = cache.etag;

  try {
    const response = await fetchImpl(LATEST_RELEASE_URL, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 304 && cache.release) {
      cache.expiresAt = now.getTime() + CACHE_TTL_MS;
      return statusFromCache(appVersion, now);
    }
    if (!response.ok) throw new Error(`github-release-${response.status}`);

    const payload = (await response.json()) as GitHubLatestRelease;
    cache = {
      etag: response.headers.get('etag'),
      expiresAt: now.getTime() + CACHE_TTL_MS,
      release: payload,
    };
    return statusFromCache(appVersion, now);
  } catch {
    if (cache.release) return statusFromCache(appVersion, now);
    return buildReleaseUpdateStatus({ currentVersion: appVersion, checkedAt: now });
  }
}

export function resetGitHubReleaseCacheForTests(): void {
  cache = { etag: null, expiresAt: 0, release: null };
}
