import { afterEach, describe, expect, it } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useEffect, type ReactNode } from 'react';
import { createMeStore } from './me-store';
import { useMeStore } from './hooks';
import type { MeResponse } from './types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function me(interfaceMode: 'classic' | 'focus'): MeResponse {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      image: null,
      status: 'APPROVED',
      role: 'USER',
      theme: 'linear',
      interfaceMode,
    },
    setupComplete: true,
    onboardingDone: true,
    language: 'pt-BR',
  };
}

describe('me store revalidation', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('keeps mounted children alive during a background refresh', async () => {
    const initial = deferred<MeResponse>();
    const background = deferred<MeResponse>();
    const requests = [initial, background];
    const store = createMeStore(() => requests.shift()!.promise);
    let mounts = 0;
    let unmounts = 0;

    function Child(): ReactNode {
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <span>ready</span>;
    }

    function Shell(): ReactNode {
      const { data, loading } = useMeStore(store);
      return loading || !data ? 'loading' : <Child />;
    }

    await act(async () => {
      renderer = create(<Shell />);
    });
    await act(async () => {
      initial.resolve(me('classic'));
      await initial.promise;
    });
    expect(mounts).toBe(1);

    let refresh!: Promise<void>;
    await act(async () => {
      refresh = store.refresh();
      await Promise.resolve();
    });
    expect(store.getSnapshot().loading).toBe(false);
    expect(renderer!.root.findByType('span').children).toEqual(['ready']);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);

    await act(async () => {
      background.resolve(me('classic'));
      await refresh;
    });
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('discards an older refresh after a confirmed local mutation', async () => {
    const initial = deferred<MeResponse>();
    const stale = deferred<MeResponse>();
    const requests = [initial, stale];
    const store = createMeStore(() => requests.shift()!.promise);

    const load = store.ensureLoaded();
    initial.resolve(me('classic'));
    await load;

    const refresh = store.refresh();
    store.mutate((current) => ({
      ...current,
      user: current.user ? { ...current.user, interfaceMode: 'focus' } : null,
    }));
    stale.resolve(me('classic'));
    await refresh;

    expect(store.getSnapshot().data?.user?.interfaceMode).toBe('focus');
    expect(store.getSnapshot().loading).toBe(false);
  });
});
