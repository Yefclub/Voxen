import { describe, expect, mock, test } from 'bun:test';
import {
  activatePromptedVersionUpdate,
  applyVersionUpdate,
  prepareVersionUpdate,
  UPDATE_FALLBACK_MS,
  UPDATE_READY_TIMEOUT_MS,
  type VersionUpdateRuntime,
} from './version-apply';

function runtimeHarness(requestActivation: VersionUpdateRuntime['requestActivation']): {
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
      requestActivation,
      onControllerChange: (listener) => {
        controllerChange = listener;
        return () => {
          controllerChange = null;
        };
      },
    },
  };
}

describe('aplicação da atualização', () => {
  test('prepara o service worker sem recarregar e tolera ausência ou falha', async () => {
    const update = mock(async () => undefined);

    await prepareVersionUpdate({ getRegistration: async () => ({ update }) });
    await prepareVersionUpdate({ getRegistration: async () => null });
    await prepareVersionUpdate({
      getRegistration: async () => {
        throw new Error('service worker unavailable');
      },
    });

    expect(update).toHaveBeenCalledTimes(1);
  });

  test('aguarda o worker ficar waiting antes de ativar após clique precoce', async () => {
    let signalWaiting = (): void => undefined;
    let waiting = false;
    const order: string[] = [];
    const activation = activatePromptedVersionUpdate({
      isWaiting: () => waiting,
      checkForUpdate: async () => {
        order.push('check');
      },
      waitUntilWaiting: async (timeoutMs) => {
        expect(timeoutMs).toBe(UPDATE_READY_TIMEOUT_MS);
        order.push('wait');
        await new Promise<void>((resolve) => {
          signalWaiting = () => {
            waiting = true;
            resolve();
          };
        });
        return true;
      },
      activate: async () => {
        order.push('activate');
      },
    });

    await Promise.resolve();
    expect(order).toEqual(['check', 'wait']);
    signalWaiting();
    await activation;
    expect(order).toEqual(['check', 'wait', 'activate']);
  });

  test('ativa imediatamente quando o worker já está waiting', async () => {
    const checkForUpdate = mock(async () => undefined);
    const waitUntilWaiting = mock(async () => true);
    const activate = mock(async () => undefined);

    await activatePromptedVersionUpdate({
      isWaiting: () => true,
      checkForUpdate,
      waitUntilWaiting,
      activate,
    });

    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(waitUntilWaiting).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  test('limpa o adiamento, atualiza o service worker e recarrega ao trocar controller', async () => {
    const requestActivation = mock(async () => undefined);
    const harness = runtimeHarness(requestActivation);

    await applyVersionUpdate(harness.runtime);
    expect(harness.clearSnooze).toHaveBeenCalledTimes(1);
    expect(requestActivation).toHaveBeenCalledTimes(1);
    expect(harness.reload).not.toHaveBeenCalled();

    harness.signalControllerChange();
    harness.runFallback();
    expect(harness.cancelFallback).toHaveBeenCalledWith('timer');
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  test('fallback recarrega uma única vez se o controller novo não assumir', async () => {
    const harness = runtimeHarness(async () => undefined);
    await applyVersionUpdate(harness.runtime);

    harness.runFallback();
    harness.runFallback();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  test('falha ao ativar recarrega imediatamente pelo caminho comum', async () => {
    const harness = runtimeHarness(async () => {
      throw new Error('service worker unavailable');
    });
    await applyVersionUpdate(harness.runtime);
    expect(harness.cancelFallback).not.toHaveBeenCalled();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });
});
