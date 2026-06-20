import { useEffect, useRef } from 'react';

export interface SwipeSample {
  /** Deslocamento horizontal acumulado (px). Positivo = direita. */
  dx: number;
  /** Deslocamento vertical acumulado (px). */
  dy: number;
  /** X do ponto inicial do toque (px a partir da borda esquerda). */
  startX: number;
}

export interface EdgeSwipeThresholds {
  /** Largura (px) da zona de borda esquerda onde o gesto de abrir começa. */
  edgeZone: number;
  /** Deslocamento horizontal mínimo (px) pra confirmar o gesto. */
  minDistance: number;
  /**
   * Razão máxima |dy|/|dx| pra contar como horizontal (descarta scroll
   * vertical). Ex.: 0.6 = o movimento vertical não pode passar de 60% do
   * horizontal.
   */
  maxAngleRatio: number;
}

export const DEFAULT_THRESHOLDS: EdgeSwipeThresholds = {
  edgeZone: 28,
  minDistance: 56,
  maxAngleRatio: 0.6,
};

/**
 * Decide se uma amostra de gesto conta como swipe de abertura (borda
 * esquerda → direita). Pura e determinística pra ser testável sem DOM.
 */
export function isOpenSwipe(s: SwipeSample, t: EdgeSwipeThresholds = DEFAULT_THRESHOLDS): boolean {
  if (s.startX > t.edgeZone) return false; // não começou na borda esquerda
  if (s.dx < t.minDistance) return false; // não andou o suficiente pra direita
  if (Math.abs(s.dy) > Math.abs(s.dx) * t.maxAngleRatio) return false; // muito vertical
  return true;
}

/**
 * Decide se uma amostra conta como swipe de fechamento (direita → esquerda).
 */
export function isCloseSwipe(s: SwipeSample, t: EdgeSwipeThresholds = DEFAULT_THRESHOLDS): boolean {
  if (-s.dx < t.minDistance) return false; // não andou o suficiente pra esquerda
  if (Math.abs(s.dy) > Math.abs(s.dx) * t.maxAngleRatio) return false;
  return true;
}

/**
 * Detecta swipe de borda pra abrir/fechar o drawer mobile via handlers de
 * touch em `window`. Usa refs durante o gesto — nenhum re-render por
 * touchmove, então é leve. Só ativa quando `enabled` é true.
 *
 * - `onOpen`: swipe da borda esquerda → direita (quando fechado).
 * - `onClose`: swipe direita → esquerda (quando aberto).
 */
export function useEdgeSwipe({
  enabled,
  isOpen,
  onOpen,
  onClose,
  thresholds = DEFAULT_THRESHOLDS,
}: {
  enabled: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  thresholds?: EdgeSwipeThresholds;
}): void {
  // Callbacks/estado em refs pra não re-anexar listeners a cada render.
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const isOpenRef = useRef(isOpen);
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;
  isOpenRef.current = isOpen;

  useEffect(() => {
    if (!enabled) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = e.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      // Só rastreia se: drawer aberto (pra fechar) OU toque na borda esquerda
      // (pra abrir). Evita custo em toques no meio da tela.
      tracking = isOpenRef.current || startX <= thresholds.edgeZone;
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const sample: SwipeSample = {
        dx: touch.clientX - startX,
        dy: touch.clientY - startY,
        startX,
      };
      if (isOpenRef.current) {
        if (isCloseSwipe(sample, thresholds)) onCloseRef.current();
      } else if (isOpenSwipe(sample, thresholds)) {
        onOpenRef.current();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, thresholds]);
}
