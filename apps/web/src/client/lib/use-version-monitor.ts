import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVersionSnooze,
  parseVersionSnooze,
  resolveServerBuild,
  shouldNotify,
  type StoredVersionSnooze,
  type VersionPayload,
} from './version-monitor-core';
import { applyVersionUpdate, prepareVersionUpdate } from './version-apply';

export interface VersionUpdate {
  fromVersion: string | null;
  toVersion: string | null;
  serverBuild: string | null;
}

export interface VersionMonitorState {
  update: VersionUpdate | null;
  apply: () => void;
  snooze: () => void;
}

const VERSION_POLL_MS = 60_000;
const SNOOZE_KEY = 'voxen.versionMonitor.snooze';

let inMemorySnooze: StoredVersionSnooze | null = null;

function readSnooze(): StoredVersionSnooze | null {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    if (!raw) return inMemorySnooze;
    return parseVersionSnooze(raw) ?? inMemorySnooze;
  } catch {
    return inMemorySnooze;
  }
}

function writeSnooze(build: string): void {
  const value = createVersionSnooze(build);
  inMemorySnooze = value;
  try {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(value));
  } catch {
    // sem localStorage: o fallback em memória mantém o adiamento nesta sessão.
  }
}

function clearSnooze(): void {
  inMemorySnooze = null;
  try {
    window.localStorage.removeItem(SNOOZE_KEY);
  } catch {
    // sem localStorage: o fallback já foi limpo.
  }
}

/**
 * Aplica o update do PWA. Limpa apenas o adiamento temporário, tenta o caminho
 * normal (SW update + controllerchange → reload) e, se ele não recarregar em
 * ~3,5s, faz um reload simples. O build não é marcado como aplicado antes de o
 * novo HTML realmente carregar: se a aba continuar antiga, o aviso volta.
 */
async function applyUpdate(): Promise<void> {
  const serviceWorker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  await applyVersionUpdate({
    clearSnooze,
    reload: () => window.location.reload(),
    scheduleFallback: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelFallback: (handle) => window.clearTimeout(handle as number),
    getRegistration: async () => (await serviceWorker?.getRegistration()) ?? null,
    onControllerChange: (listener) => {
      serviceWorker?.addEventListener('controllerchange', listener, { once: true });
    },
  });
}

async function prepareUpdate(): Promise<void> {
  const serviceWorker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  await prepareVersionUpdate({
    getRegistration: async () => (await serviceWorker?.getRegistration()) ?? null,
  });
}

/**
 * Monitor de versão (padrão Orbital): reconsulta /api/version a cada 60s +
 * nos eventos focus/online/visibilitychange e expõe a transição de versão
 * (de→para) quando detecta build novo — renderizada como modal pelo
 * `<UpdateModal>`, com ações de recarregar/adiar.
 *
 * À prova de loop:
 *  - Um adiamento persiste por 30 minutos, sem esconder a versão para sempre.
 *  - O "Atualizar" usa o fluxo normal do SW e fallback de reload; se o bundle
 *    continuar antigo, a comparação de builds permanece verdadeira.
 *
 * Baseline de identidade do bundle carregado:
 * 1. Meta `voxen-build` injetado pelo servidor no HTML servido. Essencial no
 *    PWA: o SW serve index.html precacheado (antigo), então um baseline buscado
 *    da rede viria sempre do servidor novo e o app instalado nunca se perceberia
 *    velho. Com o meta, mismatch contra /api/version = bundle de outro build.
 * 2. Fallback (dev Vite, builds antigos sem o meta): baseline da primeira
 *    resposta de /api/version.
 */
export function useVersionMonitor(enabled: boolean): VersionMonitorState {
  const [update, setUpdate] = useState<VersionUpdate | null>(null);
  // Evita re-emitir o mesmo build a cada poll enquanto o modal está aberto.
  const shownBuildRef = useRef<string | null>(null);
  // Evita disparar registration.update() repetidamente para o mesmo deploy.
  const preparedBuildRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const buildMeta =
      document.querySelector('meta[name="voxen-build"]')?.getAttribute('content') || null;
    const versionMeta =
      document.querySelector('meta[name="voxen-version"]')?.getAttribute('content') || null;
    let loadedVersion: string | null = versionMeta;
    // baseline de identidade (dev sem meta).
    let baseline: string | null = null;
    let stopped = false;
    const controller = new AbortController();

    const check = async () => {
      if (stopped) return;
      let payload: VersionPayload;
      try {
        const res = await fetch('/api/version', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) return;
        payload = (await res.json()) as VersionPayload;
      } catch {
        // Rede instável/offline: silêncio — o próximo ciclo tenta de novo.
        return;
      }
      if (stopped) return;

      const serverBuild = resolveServerBuild(payload);
      let loadedBuild: string | null;
      if (buildMeta) {
        loadedBuild = buildMeta;
      } else {
        // dev/builds antigos: a primeira resposta vira baseline (identidade +
        // version amigável do bundle carregado).
        if (baseline === null) {
          baseline = serverBuild;
          loadedVersion = payload.version ?? null;
          return;
        }
        loadedBuild = baseline;
      }

      const snooze = readSnooze();
      if (
        !shouldNotify({
          serverBuild,
          loadedBuild,
          snoozedBuild: snooze?.build ?? null,
          snoozedUntil: snooze?.until ?? null,
        })
      ) {
        return;
      }
      if (shownBuildRef.current === serverBuild) return;
      shownBuildRef.current = serverBuild;
      if (preparedBuildRef.current !== serverBuild) {
        preparedBuildRef.current = serverBuild;
        void prepareUpdate();
      }
      setUpdate({
        fromVersion: loadedVersion,
        toVersion: payload.version ?? null,
        serverBuild,
      });
    };

    const onWake = () => {
      if (document.visibilityState === 'hidden') return;
      void check();
    };

    void check();
    const interval = setInterval(() => {
      void check();
    }, VERSION_POLL_MS);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);

    return () => {
      stopped = true;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled]);

  const apply = useCallback(() => {
    if (update) void applyUpdate();
  }, [update]);

  const snooze = useCallback(() => {
    if (update?.serverBuild) writeSnooze(update.serverBuild);
    shownBuildRef.current = null;
    setUpdate(null);
  }, [update]);

  return { update, apply, snooze };
}
