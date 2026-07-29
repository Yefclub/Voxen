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
  /** Fração inicial da viewport que permite o gesto central de abertura. */
  centralStartRatio: number;
  /** Fração final da viewport que permite o gesto central de abertura. */
  centralEndRatio: number;
}

// Calibragem alinhada a padrões mobile 2025: zona de borda estreita (~24px) pra
// não capturar toques de conteúdo, e deslocamento mínimo de 60px pra confirmar
// intenção de gesto (descarta toques curtos/acidentais). Ângulo ≤ 0.6 descarta
// scroll vertical. Caveat (PWA no browser): a borda esquerda colide com o gesto
// "voltar" do navegador/OS — confiável só em PWA instalado (standalone).
export const DEFAULT_THRESHOLDS: EdgeSwipeThresholds = {
  edgeZone: 24,
  minDistance: 60,
  maxAngleRatio: 0.6,
  centralStartRatio: 0.2,
  centralEndRatio: 0.8,
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
 * Gesto complementar ao da borda: começa na região central da viewport e vai
 * para a direita. Mantê-lo puro permite testar o limiar sem DOM e evita estado
 * React durante o movimento.
 */
export function isCentralOpenSwipe(
  s: SwipeSample,
  viewportWidth: number,
  t: EdgeSwipeThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;
  const minX = viewportWidth * t.centralStartRatio;
  const maxX = viewportWidth * t.centralEndRatio;
  if (s.startX < minX || s.startX > maxX) return false;
  if (s.dx < t.minDistance) return false;
  if (Math.abs(s.dy) > Math.abs(s.dx) * t.maxAngleRatio) return false;
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

function startsOnInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'a,button,input,textarea,select,summary,[contenteditable="true"],[role="button"],[data-drawer-gesture-ignore]',
    ),
  );
}

/**
 * Detecta swipe de borda pra abrir/fechar o drawer mobile via handlers de
 * touch em `window`. Usa refs durante o gesto — nenhum re-render por
 * touchmove, então é leve. Só ativa quando `enabled` é true.
 *
 * - `onOpen`: swipe da borda esquerda OU do centro → direita (quando fechado).
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
      // Não compete com links, campos ou controles. O listener é passivo e só
      // decide no fim: scroll vertical e pinch-zoom continuam do navegador.
      if (startsOnInteractiveElement(e.target)) {
        tracking = false;
        return;
      }
      // Rastreia fechamento, borda e a faixa central. Não atualiza React a
      // cada touchmove — a abertura só ocorre após gesto horizontal confirmado.
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const centralMin = viewportWidth * thresholds.centralStartRatio;
      const centralMax = viewportWidth * thresholds.centralEndRatio;
      tracking =
        isOpenRef.current ||
        startX <= thresholds.edgeZone ||
        (startX >= centralMin && startX <= centralMax);
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
      } else if (
        isOpenSwipe(sample, thresholds) ||
        isCentralOpenSwipe(sample, window.visualViewport?.width ?? window.innerWidth, thresholds)
      ) {
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
