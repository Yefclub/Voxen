import { useEffect } from 'react';
import { toast } from 'sonner';
import { useI18n } from './i18n';
import {
  formatUpdateMessage,
  resolveServerBuild,
  shouldNotify,
  type VersionPayload,
} from './version-monitor-core';

const VERSION_POLL_MS = 60_000;
// Id fixo: sonner deduplica por id, então o toast nunca aparece em dobro
// mesmo com vários ciclos de poll detectando a mesma versão nova.
const UPDATE_TOAST_ID = 'voxen-version-update';
// Build já tratado pelo usuário (dispensado OU acionado). Persistido pra que o
// toast NÃO reapareça em loop pro mesmo build — o furo principal do sistema
// antigo. Só um serverBuild diferente do registrado aqui volta a notificar.
const HANDLED_BUILD_KEY = 'voxen.versionMonitor.handledBuild';
// Tempo até o fallback nuclear assumir se o reload normal não trouxe o build novo.
const NUCLEAR_FALLBACK_MS = 3500;

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

// Limpa caches do PWA + desregistra o SW pra forçar o servidor a entregar o
// build fresco no reload. Tudo defensivo: ausência de caches/SW não lança.
async function nukeCachesAndServiceWorker(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // ignora falha de caches
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    // ignora falha de unregister
  }
}

/**
 * Aplica o update do PWA. Persiste o build acionado ANTES de recarregar (pra não
 * reaparecer), tenta o caminho normal (SW update + controllerchange → reload) e,
 * se ele não recarregar em ~3,5s, dispara o fallback nuclear: limpa caches +
 * desregistra o SW + reload — garantindo pegar o build fresco do servidor.
 */
async function applyUpdate(serverBuild: string | null): Promise<void> {
  if (serverBuild) writeHandledBuild(serverBuild);
  toast.dismiss(UPDATE_TOAST_ID);

  let reloaded = false;
  const reloadOnce = (): void => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  // Fallback nuclear: se o caminho normal não recarregou a tempo, limpa tudo e
  // recarrega na marra. Só roda se o reloadOnce ainda não disparou.
  const nuclearTimer = window.setTimeout(() => {
    if (reloaded) return;
    void nukeCachesAndServiceWorker().finally(reloadOnce);
  }, NUCLEAR_FALLBACK_MS);

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        // Quando o SW novo assume o controle, os assets servidos já são os novos.
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            window.clearTimeout(nuclearTimer);
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
  // Sem SW: o timer nuclear é desnecessário, recarrega já.
  window.clearTimeout(nuclearTimer);
  window.location.reload();
}

/**
 * Monitor de versão (padrão Orbital): reconsulta /api/version a cada 60s +
 * nos eventos focus/online/visibilitychange e mostra toast com a transição de
 * versão (de→para) e ação de recarregar quando detecta build novo.
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
export function useVersionMonitor(enabled: boolean): void {
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled) return;
    const buildMeta =
      document.querySelector('meta[name="voxen-build"]')?.getAttribute('content') || null;
    // version amigável do bundle carregado (quando o meta = gitSha, fica null e
    // o toast cai pro formato "(Y)").
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

      const message = formatUpdateMessage(t, {
        loadedVersion,
        serverVersion: payload.version ?? null,
      });
      toast(message, {
        id: UPDATE_TOAST_ID,
        duration: Infinity,
        closeButton: true,
        // Dispensar persiste: o mesmo build não reaparece.
        onDismiss: () => {
          if (serverBuild) writeHandledBuild(serverBuild);
        },
        action: {
          label: t('shell.updateAction'),
          onClick: () => void applyUpdate(serverBuild),
        },
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
  }, [enabled, t]);
}
