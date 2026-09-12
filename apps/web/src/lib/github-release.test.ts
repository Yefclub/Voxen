import { afterEach, describe, expect, it } from 'bun:test';
import { getGitHubReleaseUpdate, resetGitHubReleaseCacheForTests } from './github-release';

afterEach(() => resetGitHubReleaseCacheForTests());

describe('GitHub release update lookup', () => {
  it('uses the fixed GitHub endpoint and returns a newer release', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({ tag_name: 'v0.14.5', draft: false, prerelease: false }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"release-1"' },
        },
      );
    }) as unknown as typeof fetch;

    const result = await getGitHubReleaseUpdate(
      '0.14.4',
      fetchImpl,
      new Date('2026-08-07T12:00:00.000Z'),
    );
    expect(requestedUrl).toBe('https://api.github.com/repos/Yefclub/Voxen/releases/latest');
    expect(result.available).toBe(true);
  });

  it('uses the in-memory cache between authenticated clients', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ tag_name: 'v0.14.5' }), { status: 200 });
    }) as unknown as typeof fetch;

    await getGitHubReleaseUpdate('0.14.4', fetchImpl, new Date('2026-08-07T12:00:00.000Z'));
    await getGitHubReleaseUpdate('0.14.4', fetchImpl, new Date('2026-08-07T12:10:00.000Z'));
    expect(calls).toBe(1);
  });

  it('fails closed when GitHub is unavailable and no cache exists', async () => {
    const fetchImpl = (async () =>
      new Response('limited', { status: 429 })) as unknown as typeof fetch;
    const result = await getGitHubReleaseUpdate('0.14.4', fetchImpl);
    expect(result.available).toBe(false);
    expect(result.latestVersion).toBeNull();
  });
});
