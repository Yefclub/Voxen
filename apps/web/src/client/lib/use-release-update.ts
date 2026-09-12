import { useCallback, useEffect, useState } from 'react';
import type { ReleaseUpdateStatus } from '../../shared/release-update';
import { apiGet } from './api';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
let cachedStatus: ReleaseUpdateStatus | null = null;
let cacheExpiresAt = 0;
let pendingRequest: Promise<ReleaseUpdateStatus> | null = null;

type ReleaseStatusLoader = () => Promise<ReleaseUpdateStatus>;

export async function loadReleaseUpdate(
  loader: ReleaseStatusLoader = () => apiGet<ReleaseUpdateStatus>('/api/releases/latest'),
  now = Date.now(),
): Promise<ReleaseUpdateStatus> {
  if (cachedStatus && cacheExpiresAt > now) return cachedStatus;
  if (pendingRequest) return pendingRequest;

  pendingRequest = loader()
    .then((next) => {
      cachedStatus = next;
      cacheExpiresAt = now + REFRESH_INTERVAL_MS;
      return next;
    })
    .finally(() => {
      pendingRequest = null;
    });
  return pendingRequest;
}

export function resetReleaseUpdateClientCacheForTests(): void {
  cachedStatus = null;
  cacheExpiresAt = 0;
  pendingRequest = null;
}

export function useReleaseUpdate(): ReleaseUpdateStatus | null {
  const [status, setStatus] = useState<ReleaseUpdateStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadReleaseUpdate();
      setStatus(next.available ? next : null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return status;
}
