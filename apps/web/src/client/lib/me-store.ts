import { ApiError, apiGet } from './api';
import type { MeResponse } from './types';

export type MeState = { data: MeResponse | null; loading: boolean; error: string | null };
type MeSubscriber = () => void;
type MeFetcher = () => Promise<MeResponse>;

export type MeStore = ReturnType<typeof createMeStore>;

/**
 * Session cache with stale-while-revalidate semantics.
 *
 * Keeping this store independent from React makes request ordering explicit:
 * local mutations invalidate older reads, and background refreshes never hide
 * an already-mounted application shell.
 */
export function createMeStore(fetcher: MeFetcher = () => apiGet<MeResponse>('/api/me')) {
  let state: MeState = { data: null, loading: true, error: null };
  let requestGeneration = 0;
  let initialRequest: Promise<void> | null = null;
  const subscribers = new Set<MeSubscriber>();

  const emit = (): void => subscribers.forEach((subscriber) => subscriber());

  const refresh = async (): Promise<void> => {
    const generation = ++requestGeneration;
    state = { ...state, loading: state.data === null, error: null };
    emit();

    try {
      const data = await fetcher();
      if (generation !== requestGeneration) return;
      state = { data, loading: false, error: null };
    } catch (error) {
      if (generation !== requestGeneration) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        state = { data: null, loading: false, error: null };
      } else {
        state = {
          data: state.data,
          loading: false,
          error: error instanceof Error ? error.message : 'Erro ao carregar sessão.',
        };
      }
    }
    emit();
  };

  const ensureLoaded = (): Promise<void> => {
    if (!state.loading) return Promise.resolve();
    if (!initialRequest) {
      initialRequest = refresh().finally(() => {
        initialRequest = null;
      });
    }
    return initialRequest;
  };

  const mutate = (updater: (current: MeResponse) => MeResponse): void => {
    if (state.data === null) return;
    // Any response started before this confirmed local mutation is obsolete.
    requestGeneration += 1;
    state = { data: updater(state.data), loading: false, error: null };
    emit();
  };

  return {
    getSnapshot: (): MeState => state,
    subscribe: (subscriber: MeSubscriber): (() => void) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    ensureLoaded,
    refresh,
    mutate,
  };
}

export const meStore = createMeStore();
