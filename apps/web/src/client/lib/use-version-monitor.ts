import { useEffect } from 'react';
import { toast } from 'sonner';
import { useI18n } from './i18n';

const VERSION_POLL_MS = 60_000;
// Id fixo: sonner deduplica por id, então o toast nunca aparece em dobro
// mesmo com vários ciclos de poll detectando a mesma versão nova.
const UPDATE_TOAST_ID = 'voxen-version-update';

interface VersionPayload {
  version?: string;
  gitSha?: string | null;
}

// Aplica o update do PWA de verdade: força o service worker a buscar/ativar o
// build novo e só então recarrega. Sem isto, window.location.reload() pega o
// index.html precacheado (antigo) e o toast de "nova versão" reaparece em loop.
async function applyUpdate(): Promise<void> {
  toast.dismiss(UPDATE_TOAST_ID);
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        let reloaded = false;
        const reloadOnce = (): void => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        };
        // Quando o SW novo assume o controle, os assets servidos já são os novos.
        navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
        await reg.update();
        // autoUpdate já faz skipWaiting; se houver um SW esperando, força assumir.
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        // Fallback: se nenhum SW novo assumir em 3s, recarrega mesmo assim.
        setTimeout(reloadOnce, 3000);
        return;
      }
    }
  } catch {
    // sem service worker / erro: cai no reload simples
  }
  window.location.reload();
}

/**
 * Monitor de versão (padrão Orbital): reconsulta /api/version a cada 60s +
 * nos eventos focus/online/visibilitychange e mostra toast persistente com
 * ação de recarregar quando detecta build novo — o reload pega o index.html
 * fresco (no-store) e o sw.js novo (no-cache), completando o update do PWA.
 * Falhas de rede são silenciosas: tenta de novo no próximo ciclo.
 *
 * Baseline em duas camadas:
 * 1. Meta `voxen-build` injetado pelo servidor no HTML servido — é a
 *    identidade do PRÓPRIO bundle carregado. Essencial no PWA: o service
 *    worker serve index.html precacheado (antigo), então baseline buscado da
 *    rede viria sempre do servidor novo e o app instalado nunca se perceberia
 *    velho. Com o meta, mismatch contra /api/version = bundle de outro build.
 * 2. Fallback (dev server Vite, builds antigos sem o meta): baseline da
 *    primeira resposta de /api/version, como antes.
 */
export function useVersionMonitor(enabled: boolean): void {
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled) return;
    const buildMeta =
      document.querySelector('meta[name="voxen-build"]')?.getAttribute('content') || null;
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
      if (buildMeta) {
        // O servidor injeta gitSha quando disponível, senão a version — mesma
        // ordem de fallback usada na comparação aqui.
        const serverBuild = payload.gitSha || payload.version || null;
        if (!serverBuild || serverBuild === buildMeta) return;
      } else {
        const version = payload.version;
        if (!version) return;
        if (baseline === null) {
          baseline = version;
          return;
        }
        if (version === baseline) return;
      }
      toast(t('shell.updateAvailable'), {
        id: UPDATE_TOAST_ID,
        duration: Infinity,
        action: {
          label: t('shell.updateAction'),
          onClick: () => void applyUpdate(),
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
