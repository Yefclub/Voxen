import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './api';
import type { MeResponse } from './types';

// ============================================================================
// useMe — sessão atual (auto-refetch on mount; revalida sob demanda)
// ============================================================================
type MeState = { data: MeResponse | null; loading: boolean; error: string | null };

const meSubscribers = new Set<(s: MeState) => void>();
let meCache: MeState = { data: null, loading: true, error: null };

async function fetchMe(): Promise<void> {
  meCache = { ...meCache, loading: true, error: null };
  meSubscribers.forEach((cb) => cb(meCache));
  try {
    const data = await apiGet<MeResponse>('/api/me');
    meCache = { data, loading: false, error: null };
  } catch (e) {
    meCache = {
      data: null,
      loading: false,
      error: e instanceof Error ? e.message : 'Erro ao carregar sessão.',
    };
  }
  meSubscribers.forEach((cb) => cb(meCache));
}

export function useMe(): MeState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<MeState>(meCache);
  useEffect(() => {
    meSubscribers.add(setState);
    if (meCache.data === null && !meCache.error) {
      void fetchMe();
    } else {
      setState(meCache);
    }
    return () => {
      meSubscribers.delete(setState);
    };
  }, []);
  return { ...state, refresh: fetchMe };
}

// ============================================================================
// useFetch — wrapper genérico p/ GET com revalidação
// ============================================================================
export function useFetch<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { data, loading, error, refresh };
}

// ============================================================================
// useSse — assina canal SSE em /api/jobs/:id/events
// ============================================================================
export function useSse<T>(
  url: string | null,
  onEvent: (data: T) => void,
): { connected: boolean; closed: boolean } {
  const [connected, setConnected] = useState(false);
  const [closed, setClosed] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!url) return;
    setConnected(false);
    setClosed(false);

    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener('connected', () => {
      setConnected(true);
      setClosed(false);
    });
    es.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as T;
        onEventRef.current(data);
      } catch {
        // ignora payloads inválidos
      }
    });
    es.addEventListener('snapshot', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as T;
        onEventRef.current(data);
      } catch {
        // ignora
      }
    });
    es.addEventListener('error', () => {
      setConnected(false);
      setClosed(true);
    });

    return () => {
      es.close();
      setClosed(true);
    };
  }, [url]);

  return { connected, closed };
}
