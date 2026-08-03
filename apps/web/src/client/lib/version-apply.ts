export const UPDATE_FALLBACK_MS = 3500;
export const UPDATE_READY_TIMEOUT_MS = 2500;

export interface VersionUpdateRegistration {
  update: () => unknown;
}

export interface VersionUpdateRuntime {
  clearSnooze: () => void;
  reload: () => void;
  scheduleFallback: (callback: () => void, delayMs: number) => unknown;
  cancelFallback: (handle: unknown) => void;
  requestActivation: () => Promise<void>;
  onControllerChange: (listener: () => void) => () => void;
}

export interface VersionUpdatePreparationRuntime {
  getRegistration: () => Promise<VersionUpdateRegistration | null>;
}

export interface PromptedUpdateRuntime {
  isWaiting: () => boolean;
  checkForUpdate: () => Promise<void>;
  waitUntilWaiting: (timeoutMs: number) => Promise<boolean>;
  activate: () => Promise<void>;
}

/**
 * Evita perder o clique quando o navegador ainda está instalando o worker.
 * Depois de uma janela limitada, ainda tentamos ativar e deixamos o reload de
 * fallback buscar o HTML `no-store`.
 */
export async function activatePromptedVersionUpdate(runtime: PromptedUpdateRuntime): Promise<void> {
  if (!runtime.isWaiting()) {
    await runtime.checkForUpdate();
    if (!runtime.isWaiting()) {
      await runtime.waitUntilWaiting(UPDATE_READY_TIMEOUT_MS);
    }
  }
  await runtime.activate();
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
  let fallback: unknown | null = null;
  const reloadOnce = (): void => {
    if (reloaded) return;
    reloaded = true;
    runtime.reload();
  };
  let unsubscribe = (): void => undefined;
  unsubscribe = runtime.onControllerChange(() => {
    if (fallback !== null) runtime.cancelFallback(fallback);
    unsubscribe();
    reloadOnce();
  });

  try {
    // `registerSW` em modo prompt envia SKIP_WAITING somente nesta chamada.
    await runtime.requestActivation();
  } catch {
    // Sem service worker ou falha de ativação: recarrega pelo caminho comum.
    unsubscribe();
    reloadOnce();
    return;
  }

  if (reloaded) return;
  fallback = runtime.scheduleFallback(() => {
    unsubscribe();
    reloadOnce();
  }, UPDATE_FALLBACK_MS);
}
