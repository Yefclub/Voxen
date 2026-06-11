import { useEffect } from 'react';
import { toast } from 'sonner';
import { useI18n } from './i18n';

const VERSION_POLL_MS = 60_000;
// Id fixo: sonner deduplica por id, então o toast nunca aparece em dobro
// mesmo com vários ciclos de poll detectando a mesma versão nova.
const UPDATE_TOAST_ID = 'voxen-version-update';

interface VersionPayload {
  version?: string;
}

/**
 * Monitor de versão (padrão Orbital): captura a versão do backend na montagem
 * como baseline e reconsulta a cada 60s + nos eventos focus/online/
 * visibilitychange. Se o backend reportar versão diferente (deploy novo),
 * mostra toast persistente com ação de recarregar — o reload pega o index.html
 * fresco (no-store) e o sw.js novo (no-cache), completando o update do PWA.
 * Falhas de rede são silenciosas: tenta de novo no próximo ciclo.
 */
export function useVersionMonitor(enabled: boolean): void {
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled) return;
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
      const version = payload.version;
      if (!version || stopped) return;
      if (baseline === null) {
        baseline = version;
        return;
      }
      if (version === baseline) return;
      toast(t('shell.updateAvailable'), {
        id: UPDATE_TOAST_ID,
        duration: Infinity,
        action: {
          label: t('shell.updateAction'),
          onClick: () => window.location.reload(),
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
