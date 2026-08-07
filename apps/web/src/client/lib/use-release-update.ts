import { useCallback, useEffect, useState } from 'react';
import type { ReleaseUpdateStatus } from '../../shared/release-update';
import { apiGet } from './api';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export function useReleaseUpdate(): ReleaseUpdateStatus | null {
  const [status, setStatus] = useState<ReleaseUpdateStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await apiGet<ReleaseUpdateStatus>('/api/releases/latest');
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
