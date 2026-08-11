import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apiGet } from './api';
import { meStore, type MeStore } from './me-store';

// ============================================================================
// useMe — sessão atual (auto-refetch on mount; revalida sob demanda)
// ============================================================================
export function useMeStore(store: MeStore) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    void store.ensureLoaded();
  }, [store]);
  return { ...state, refresh: store.refresh, mutate: store.mutate };
}

export function useMe() {
  return useMeStore(meStore);
}

// ============================================================================
// useFetch — wrapper genérico p/ GET com revalidação
// ============================================================================
export function useFetch<T>(path: string | null): {
  data: T | null;
  resolvedPath: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadedPath = useRef<string | null>(null);
  const resumeRefreshInFlight = useRef(false);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const revalidateWhenVisible = (): void => {
      if (document.visibilityState !== 'visible' || resumeRefreshInFlight.current) return;
      // visibilitychange + focus/pageshow normalmente chegam juntos. A trava
      // permanece até a consulta disparada abaixo terminar.
      resumeRefreshInFlight.current = true;
      setTick((n) => n + 1);
    };
    window.addEventListener('focus', revalidateWhenVisible);
    window.addEventListener('pageshow', revalidateWhenVisible);
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () => {
      window.removeEventListener('focus', revalidateWhenVisible);
      window.removeEventListener('pageshow', revalidateWhenVisible);
      document.removeEventListener('visibilitychange', revalidateWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setResolvedPath(null);
      setLoading(false);
      resumeRefreshInFlight.current = false;
      return;
    }
    let cancelled = false;
    // Revalidação é stale-while-revalidate: mantém dados e controles visíveis.
    // A tela de loading só volta quando ainda não existe conteúdo para mostrar.
    setLoading(loadedPath.current !== path);
    setError(null);
    apiGet<T>(path)
      .then((d) => {
        if (!cancelled) {
          loadedPath.current = path;
          setData(d);
          setResolvedPath(path);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro.');
      })
      .finally(() => {
        resumeRefreshInFlight.current = false;
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { data, resolvedPath, loading, error, refresh };
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
