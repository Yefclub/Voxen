import { describe, expect, it } from 'bun:test';
import {
  buildReleaseUpdateStatus,
  isStableReleaseNewer,
  parseVoxenVersion,
} from './release-update';

describe('release update comparison', () => {
  it('parses stable and development versions', () => {
    expect(parseVoxenVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseVoxenVersion('1.2.3-dev.42')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'dev.42',
    });
    expect(parseVoxenVersion('1.02.3')).toBeNull();
    expect(parseVoxenVersion('latest')).toBeNull();
  });

  it('treats a stable release of the same development core as newer', () => {
    expect(isStableReleaseNewer('0.14.5-dev.1786087874', 'v0.14.5')).toBe(true);
    expect(isStableReleaseNewer('0.14.5', 'v0.14.5')).toBe(false);
    expect(isStableReleaseNewer('0.14.5', 'v0.14.6')).toBe(true);
    expect(isStableReleaseNewer('0.15.0-dev.1', 'v0.14.9')).toBe(false);
  });

  it('fails closed for drafts, prereleases, invalid tags, and invalid installed versions', () => {
    expect(
      buildReleaseUpdateStatus({ currentVersion: '0.14.4', latestTag: 'v0.14.5', draft: true })
        .available,
    ).toBe(false);
    expect(
      buildReleaseUpdateStatus({
        currentVersion: '0.14.4',
        latestTag: 'v0.14.5-beta.1',
        prerelease: true,
      }).available,
    ).toBe(false);
    expect(
      buildReleaseUpdateStatus({ currentVersion: '0.14.4', latestTag: 'release-latest' }).available,
    ).toBe(false);
    expect(
      buildReleaseUpdateStatus({ currentVersion: 'unknown', latestTag: 'v0.14.5' }).available,
    ).toBe(false);
  });

  it('constructs a fixed official release URL', () => {
    const status = buildReleaseUpdateStatus({
      currentVersion: '0.14.4',
      latestTag: 'v0.14.5',
      checkedAt: new Date('2026-08-07T12:00:00.000Z'),
    });
    expect(status).toMatchObject({
      available: true,
      environment: 'prod',
      latestVersion: '0.14.5',
      latestTag: 'v0.14.5',
      releaseUrl: 'https://github.com/Yefclub/Voxen/releases/tag/v0.14.5',
      checkedAt: '2026-08-07T12:00:00.000Z',
    });
  });
});
