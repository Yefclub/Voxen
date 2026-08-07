import { beforeEach, describe, expect, it } from 'bun:test';
import type { ReleaseUpdateStatus } from '../../shared/release-update';
import { loadReleaseUpdate, resetReleaseUpdateClientCacheForTests } from './use-release-update';

const status: ReleaseUpdateStatus = {
  available: true,
  currentVersion: '0.14.4',
  environment: 'prod',
  latestVersion: '0.14.5',
  latestTag: 'v0.14.5',
  releaseUrl: 'https://github.com/Yefclub/Voxen/releases/tag/v0.14.5',
  checkedAt: '2026-08-07T12:00:00.000Z',
};

beforeEach(() => resetReleaseUpdateClientCacheForTests());

describe('release update client cache', () => {
  it('coalesces simultaneous sidebar and mobile drawer requests', async () => {
    let calls = 0;
    let resolveRequest!: (value: ReleaseUpdateStatus) => void;
    const loader = () => {
      calls += 1;
      return new Promise<ReleaseUpdateStatus>((resolve) => {
        resolveRequest = resolve;
      });
    };

    const sidebar = loadReleaseUpdate(loader, 1_000);
    const drawer = loadReleaseUpdate(loader, 1_000);
    expect(calls).toBe(1);
    resolveRequest(status);
    expect(await sidebar).toEqual(status);
    expect(await drawer).toEqual(status);
  });

  it('reuses a successful response until the refresh interval expires', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return status;
    };

    await loadReleaseUpdate(loader, 1_000);
    await loadReleaseUpdate(loader, 2_000);
    expect(calls).toBe(1);
  });
});
