import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveServerBuild, shouldNotify, type VersionPayload } from './version-monitor-core';

export interface VersionUpdate {
  fromVersion: string | null;
  toVersion: string | null;
  serverBuild: string | null;
}

export interface VersionMonitorState {
  update: VersionUpdate | null;
  apply: () => void;
  dismiss: () => void;
}

const VERSION_POLL_MS = 60_000;
// Build já tratado pelo usuário (dispensado OU acionado). Persistido pra que o
// toast NÃO reapareça em loop pro mesmo build — o furo principal do sistema
// antigo. Só um serverBuild diferente do registrado aqui volta a notificar.
const HANDLED_BUILD_KEY = 'voxen.versionMonitor.handledBuild';
// Tempo até o fallback assumir se o reload normal não trouxe o build novo.
const UPDATE_FALLBACK_MS = 3500;

// localStorage defensivo: modo privado/erro não pode quebrar o monitor.
// Fallback em memória mantém a dedupe dentro da sessão atual.
let inMemoryHandledBuild: string | null = null;

function readHandledBuild(): string | null {
  try {
    return window.localStorage.getItem(HANDLED_BUILD_KEY) ?? inMemoryHandledBuild;
  } catch {
    return inMemoryHandledBuild;
  }
}

function writeHandledBuild(build: string): void {
  inMemoryHandledBuild = build;
  try {
    window.localStorage.setItem(HANDLED_BUILD_KEY, build);
  } catch {
    // sem localStorage: já guardamos em memória acima.
  }
}

/**
 * Aplica o update do PWA. Persiste o build acionado ANTES de recarregar (pra não
 * reaparecer), tenta o caminho normal (SW update + controllerchange → reload) e,
 * se ele não recarregar em ~3,5s, faz um reload simples. Nunca limpa caches nem
 * desregistra o service worker: isso pode apagar trabalho ainda em andamento.
 */
async function applyUpdate(serverBuild: string | null): Promise<void> {
  if (serverBuild) writeHandledBuild(serverBuild);

  let reloaded = false;
  const reloadOnce = (): void => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  // Se o novo controller não assumir a tempo, o reload revalida a página sem
  // destruir a instalação PWA nem seus caches.
  const updateTimer = window.setTimeout(() => {
    if (reloaded) return;
    reloadOnce();
  }, UPDATE_FALLBACK_MS);

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        // Quando o SW novo assume o controle, os assets servidos já são os novos.
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            window.clearTimeout(updateTimer);
            reloadOnce();
          },
          { once: true },
        );
        // No modo generateSW + autoUpdate (vite-plugin-pwa), o SW novo já chama
        // skipWaiting()/clientsClaim() sozinho — basta buscá-lo.
        await reg.update();
        return; // o controllerchange ou o nuclearTimer cuidam do reload
      }
    }
  } catch {
    // sem service worker / erro: cai no reload simples abaixo
  }
  // Sem SW: o timer de fallback é desnecessário, recarrega já.
  window.clearTimeout(updateTimer);
  window.location.reload();
}

/**
 * Monitor de versão (padrão Orbital): reconsulta /api/version a cada 60s +
 * nos eventos focus/online/visibilitychange e expõe a transição de versão
 * (de→para) quando detecta build novo — renderizada como modal pelo
 * `<UpdateModal>`, com ações de recarregar/dispensar.
 *
 * À prova de loop:
 *  - Persiste em localStorage o build que o usuário dispensou OU acionou; o
 *    mesmo build não re-notifica (`shouldNotify`).
 *  - O "Atualizar" tem fallback nuclear (limpa caches + unregister SW) pra
 *    garantir o reload no build fresco mesmo se o index.html precacheado for
 *    servido velho.
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

  useEffect(() => {
    if (!enabled) return;
    const buildMeta =
      document.querySelector('meta[name="voxen-build"]')?.getAttribute('content') || null;
    // version amigável do bundle carregado (quando o meta = gitSha, fica null e
    // o modal cai pro formato "(Y)").
    let loadedVersion: string | null = null;
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

      if (!shouldNotify({ serverBuild, loadedBuild, lastHandledBuild: readHandledBuild() })) {
        return;
      }
      if (shownBuildRef.current === serverBuild) return;
      shownBuildRef.current = serverBuild;
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
    if (update) void applyUpdate(update.serverBuild);
  }, [update]);

  const dismiss = useCallback(() => {
    // Dispensar persiste: o mesmo build não reaparece.
    if (update?.serverBuild) writeHandledBuild(update.serverBuild);
    setUpdate(null);
  }, [update]);

  return { update, apply, dismiss };
}
