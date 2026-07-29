import { describe, expect, mock, test } from 'bun:test';
import { applyVersionUpdate, UPDATE_FALLBACK_MS, type VersionUpdateRuntime } from './version-apply';

function runtimeHarness(registration: VersionUpdateRuntime['getRegistration']): {
  runtime: VersionUpdateRuntime;
  clearSnooze: ReturnType<typeof mock>;
  reload: ReturnType<typeof mock>;
  cancelFallback: ReturnType<typeof mock>;
  runFallback: () => void;
  signalControllerChange: () => void;
} {
  let fallback: (() => void) | null = null;
  let controllerChange: (() => void) | null = null;
  const clearSnooze = mock(() => undefined);
  const reload = mock(() => undefined);
  const cancelFallback = mock(() => undefined);
  return {
    clearSnooze,
    reload,
    cancelFallback,
    runFallback: () => fallback?.(),
    signalControllerChange: () => controllerChange?.(),
    runtime: {
      clearSnooze,
      reload,
      scheduleFallback: (callback, delayMs) => {
        expect(delayMs).toBe(UPDATE_FALLBACK_MS);
        fallback = callback;
        return 'timer';
      },
      cancelFallback,
      getRegistration: registration,
      onControllerChange: (listener) => {
        controllerChange = listener;
      },
    },
  };
}

describe('aplicação da atualização', () => {
  test('limpa o adiamento, atualiza o service worker e recarrega ao trocar controller', async () => {
    const update = mock(async () => undefined);
    const harness = runtimeHarness(async () => ({ update }));

    await applyVersionUpdate(harness.runtime);
    expect(harness.clearSnooze).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(harness.reload).not.toHaveBeenCalled();

    harness.signalControllerChange();
    harness.runFallback();
    expect(harness.cancelFallback).toHaveBeenCalledWith('timer');
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  test('fallback recarrega uma única vez se o controller novo não assumir', async () => {
    const harness = runtimeHarness(async () => ({ update: async () => undefined }));
    await applyVersionUpdate(harness.runtime);

    harness.runFallback();
    harness.runFallback();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  test('sem registro ou com falha recarrega imediatamente pelo caminho comum', async () => {
    for (const registration of [
      async () => null,
      async () => {
        throw new Error('service worker unavailable');
      },
    ]) {
      const harness = runtimeHarness(registration);
      await applyVersionUpdate(harness.runtime);
      expect(harness.cancelFallback).toHaveBeenCalledWith('timer');
      expect(harness.reload).toHaveBeenCalledTimes(1);
    }
  });
});
