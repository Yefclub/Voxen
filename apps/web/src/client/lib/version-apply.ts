export const UPDATE_FALLBACK_MS = 3500;

export interface VersionUpdateRegistration {
  update: () => unknown;
}

export interface VersionUpdateRuntime {
  clearSnooze: () => void;
  reload: () => void;
  scheduleFallback: (callback: () => void, delayMs: number) => unknown;
  cancelFallback: (handle: unknown) => void;
  getRegistration: () => Promise<VersionUpdateRegistration | null>;
  onControllerChange: (listener: () => void) => void;
}

export interface VersionUpdatePreparationRuntime {
  getRegistration: () => Promise<VersionUpdateRegistration | null>;
}

/**
 * Pede ao navegador para procurar o service worker novo assim que o mismatch
 * de build é conhecido. Não troca a página nem espera o usuário: apenas deixa
 * a atualização pronta para a ação explícita do modal.
 */
export async function prepareVersionUpdate(
  runtime: VersionUpdatePreparationRuntime,
): Promise<void> {
  try {
    await (await runtime.getRegistration())?.update();
  } catch {
    // Best effort: o monitor continuará oferecendo recarregar/adiar.
  }
}

/**
 * Executa a atualização sem assumir DOM global. O adaptador do hook fornece
 * service worker, relógio e reload; os testes exercitam as bordas sem browser.
 */
export async function applyVersionUpdate(runtime: VersionUpdateRuntime): Promise<void> {
  runtime.clearSnooze();
  let reloaded = false;
  const reloadOnce = (): void => {
    if (reloaded) return;
    reloaded = true;
    runtime.reload();
  };
  const fallback = runtime.scheduleFallback(reloadOnce, UPDATE_FALLBACK_MS);

  try {
    const registration = await runtime.getRegistration();
    if (registration) {
      runtime.onControllerChange(() => {
        runtime.cancelFallback(fallback);
        reloadOnce();
      });
      await registration.update();
      return;
    }
  } catch {
    // Sem service worker ou falha de atualização: recarrega pelo caminho comum.
  }

  runtime.cancelFallback(fallback);
  reloadOnce();
}
