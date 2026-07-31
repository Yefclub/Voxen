import { useCallback, useEffect, useRef } from 'react';

/**
 * Handle imperativo exposto por todo ícone de `components/ui/icons`.
 * `startAnimation` leva o ícone ao estado animado; `stopAnimation` devolve ao
 * repouso.
 */
export interface IconCueHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * Vocabulário de movimento das deixas ("cues") de ícone.
 *
 * O `PageShell` sobe o conteúdo em 0.38s com stagger de 55ms e a sidebar entra
 * por spring. As deixas de ícone se encaixam nessa mesma linha em vez de
 * disputar com ela: duração menor que o padrão do pacote (1s) para o gesto ler
 * como pontuação e não como performance, stagger um pouco mais apertado porque
 * os alvos são menores, e um atraso inicial que deixa o container assentar
 * antes de o ícone se desenhar.
 */
export const ICON_CUE_DURATION = 0.55;
export const ICON_CUE_STAGGER_MS = 45;
/** Tempo em estado animado antes de voltar ao repouso — cobre o desenho todo. */
export const ICON_CUE_HOLD_MS = 900;
/** Deixa o cabeçalho terminar de subir antes de pontuar com o ícone. */
export const ICON_CUE_PAGE_DELAY_MS = 120;
/** Deixa o painel da sidebar assentar antes de varrer os ícones. */
export const ICON_CUE_PANEL_DELAY_MS = 160;

export interface IconCueStep {
  startAt: number;
  stopAt: number;
}

/** Agenda de uma deixa: quando cada ícone entra e quando volta ao repouso. */
export function iconCueSchedule(count: number, baseDelayMs = 0): IconCueStep[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const startAt = baseDelayMs + index * ICON_CUE_STAGGER_MS;
    return { startAt, stopAt: startAt + ICON_CUE_HOLD_MS };
  });
}

export interface IconCueGroup {
  /** Ref estável por chave — registra o ícone no grupo, na ordem de montagem. */
  registerIcon: (key: string) => (handle: IconCueHandle | null) => void;
  /** Roda a animação dos ícones registrados, em cascata. */
  playCue: (baseDelayMs?: number) => void;
}

/**
 * Coordena a animação de um punhado de ícones como um gesto único.
 *
 * `enabled` deve refletir `prefers-reduced-motion`: com movimento reduzido a
 * deixa vira no-op (o wrapper de ícone e o próprio pacote também barram, mas
 * aqui evitamos até agendar os timers).
 */
export function useIconCueGroup(enabled: boolean): IconCueGroup {
  const handles = useRef(new Map<string, IconCueHandle>());
  const setters = useRef(new Map<string, (handle: IconCueHandle | null) => void>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // `pending` é sempre o mesmo array: `playCue` esvazia no lugar em vez de
  // reatribuir, senão a limpeza do unmount seguraria um array velho e os
  // timers vivos vazariam (acontece ao alternar a sidebar no meio da deixa).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.length = 0;
    };
  }, []);

  const registerIcon = useCallback((key: string) => {
    const cached = setters.current.get(key);
    if (cached) return cached;

    const setter = (handle: IconCueHandle | null): void => {
      if (handle) handles.current.set(key, handle);
      else handles.current.delete(key);
    };
    setters.current.set(key, setter);
    return setter;
  }, []);

  const playCue = useCallback(
    (baseDelayMs = 0) => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.length = 0;
      if (!enabled) return;

      const registered = [...handles.current.values()];
      const schedule = iconCueSchedule(registered.length, baseDelayMs);
      registered.forEach((handle, index) => {
        const step = schedule[index];
        if (!step) return;
        timers.current.push(setTimeout(() => handle.startAnimation(), step.startAt));
        timers.current.push(setTimeout(() => handle.stopAnimation(), step.stopAt));
      });
    },
    [enabled],
  );

  return { registerIcon, playCue };
}
