/**
 * Lógica pura do comportamento de scroll do chat (âncora no topo ao enviar).
 *
 * Ao enviar uma mensagem, a lista rola de forma que a mensagem do usuário
 * ancore no TOPO da área visível (estilo ChatGPT) e a resposta da IA nasça
 * e cresça no espaço abaixo. Um espaçador no fim da lista garante que a
 * posição de âncora seja alcançável mesmo com pouco conteúdo; ele encolhe
 * conforme a resposta cresce (reserva total constante → zero salto visual).
 * Quando o conteúdo se aproxima do promptbox (~3% do viewport), o follow
 * automático religa e o comportamento legado (grudar no fundo) assume.
 *
 * Este módulo não toca DOM — recebe medidas e devolve decisões, para ser
 * testável em unidade. A orquestração (refs, ResizeObserver, scrollTo) vive
 * no ChatContainer.
 */

/** Respiro entre o topo do viewport do chat e a mensagem ancorada. */
export const ANCHOR_TOP_GAP_PX = 12;

/** Mobile clearance that keeps an anchored message below the floating Topbar. */
export const MOBILE_ANCHOR_TOP_GAP_PX = 60;

/** Gap (fração do viewport) entre resposta e promptbox que religa o follow. */
export const REENGAGE_GAP_RATIO = 0.03;

/** Piso do gap de religamento — evita threshold sub-pixel em viewports baixos. */
export const REENGAGE_GAP_MIN_PX = 24;

/**
 * Mensagem do usuário mais alta que esta fração da banda visível não ancora:
 * a resposta nasceria fora da tela e o religamento por proximidade nunca
 * dispararia. Nesses casos o comportamento legado (fundo) é usado.
 */
export const ANCHOR_MAX_MESSAGE_RATIO = 0.7;

/** Abaixo disso o espaçador é considerado zerado (fundo real, não "fake"). */
export const SPACER_EPSILON_PX = 8;

/** Distância do fundo abaixo da qual o follow automático rearma (legado). */
export const FOLLOW_REARM_DISTANCE_PX = 400;

/** Distância mínima do fim para oferecer o retorno à mensagem mais recente. */
export const SCROLL_LATEST_SHOW_DISTANCE_PX = 96;

/** Tolerância para distinguir scroll manual para cima de jitter/reflow. */
export const USER_SCROLL_UP_TOLERANCE_PX = 4;

/**
 * Frames de retry aguardando a mensagem recém-enviada montar no DOM antes de
 * ancorar. O commit do React pode não ter pintado a bolha no primeiro frame
 * em conversas pesadas; esgotados os retries, cai no comportamento legado.
 */
export const ANCHOR_MOUNT_RETRY_FRAMES = 3;

/**
 * Fases do scroll:
 * - "free": comportamento legado — follow por proximidade do fundo.
 * - "anchor": mensagem do usuário ancorada no topo; follow desligado até o
 *   conteúdo se aproximar do promptbox ou o usuário intervir.
 */
export type ScrollPhase = 'free' | 'anchor';

export interface AnchorPlan {
  /** scrollTop que posiciona a mensagem no topo do viewport. */
  targetScrollTop: number;
  /** Altura inicial do espaçador para a âncora ser alcançável. */
  spacerHeight: number;
  /**
   * Fim da reserva em coordenadas de conteúdo (targetScrollTop + viewport).
   * Guardado durante o turno para recalcular o espaçador a cada crescimento.
   */
  reserveEnd: number;
}

/** Altura útil entre o topo do container e o topo do composer overlay. */
export function visibleBandHeight(clientHeight: number, composerHeight: number): number {
  return Math.max(0, clientHeight - composerHeight);
}

/**
 * Decide se a mensagem recém-enviada deve ancorar no topo. Mensagens mais
 * altas que a banda visível deixariam a resposta fora da tela — melhor cair
 * no comportamento legado.
 */
export function shouldAnchor(params: {
  messageHeight: number;
  clientHeight: number;
  composerHeight: number;
}): boolean {
  const band = visibleBandHeight(params.clientHeight, params.composerHeight);
  if (band <= 0) return false;
  return params.messageHeight <= band * ANCHOR_MAX_MESSAGE_RATIO;
}

/**
 * Calcula a âncora: alvo de scroll e espaçador necessário para alcançá-lo.
 *
 * `messageTop` em coordenadas de conteúdo (scrollTop + delta de rects).
 * `scrollHeight` é o total atual (incluindo espaçador atual, se houver) —
 * o espaçador novo repõe exatamente o que falta para
 * `scrollHeight === reserveEnd`, deixando a âncora no scroll máximo.
 */
export function planAnchor(params: {
  messageTop: number;
  clientHeight: number;
  scrollHeight: number;
  currentSpacerHeight: number;
  hasFloatingHeader?: boolean;
  topGap?: number;
}): AnchorPlan {
  const defaultTopGap = params.hasFloatingHeader ? MOBILE_ANCHOR_TOP_GAP_PX : ANCHOR_TOP_GAP_PX;
  const targetScrollTop = Math.max(0, params.messageTop - (params.topGap ?? defaultTopGap));
  const reserveEnd = targetScrollTop + params.clientHeight;
  const naturalEnd = params.scrollHeight - params.currentSpacerHeight;
  const spacerHeight = Math.max(0, reserveEnd - naturalEnd);
  return { targetScrollTop, spacerHeight, reserveEnd };
}

/**
 * Próxima altura do espaçador conforme o conteúdo real cresce: mantém a
 * reserva total constante (conteúdo cresce → espaçador encolhe na mesma
 * medida), então nada se move na tela durante o streaming. Se o conteúdo
 * encolher (reflow por resize/canvas), o espaçador re-infla para manter a
 * âncora alcançável.
 */
export function nextSpacerHeight(params: {
  reserveEnd: number;
  scrollHeight: number;
  currentSpacerHeight: number;
}): number {
  const naturalEnd = params.scrollHeight - params.currentSpacerHeight;
  return Math.max(0, params.reserveEnd - naturalEnd);
}

/** Threshold em px do gap que religa o follow (~3% do viewport, com piso). */
export function reengageThresholdPx(clientHeight: number): number {
  return Math.max(REENGAGE_GAP_MIN_PX, clientHeight * REENGAGE_GAP_RATIO);
}

/**
 * Religa o follow quando o fim do conteúdo real se aproxima do topo do
 * promptbox (overlay no rodapé do container). Medidas em coordenadas de
 * viewport (getBoundingClientRect).
 *
 * Gates extras (evitam saltar a âncora cedo demais no harness multi-tool):
 * - `spacerHeight > SPACER_EPSILON`: ainda há reserva artificial sob a âncora —
 *   o conteúdo ainda não consumiu o viewport reservado; não reengage.
 * - `allowReengage === false`: o turno ainda não recebeu conteúdo transmitido
 *   (ou o caller ainda não liberou) — manter a âncora.
 */
export function shouldReengageFollow(params: {
  contentBottomViewport: number;
  containerBottomViewport: number;
  composerHeight: number;
  clientHeight: number;
  /** Altura atual do espaçador de âncora; > epsilon bloqueia reengage. */
  spacerHeight?: number;
  /**
   * Caller libera o reengage quando chega qualquer conteúdo transmitido ou o
   * stream termina. Default true para callers legados/testes só de geometria.
   */
  allowReengage?: boolean;
}): boolean {
  if (params.allowReengage === false) return false;
  if ((params.spacerHeight ?? 0) > SPACER_EPSILON_PX) return false;
  const composerTop = params.containerBottomViewport - params.composerHeight;
  const gap = composerTop - params.contentBottomViewport;
  return gap <= reengageThresholdPx(params.clientHeight);
}

/** Scroll manual para cima (com tolerância a jitter de reflow). */
export function isUserScrollUp(prevScrollTop: number, scrollTop: number): boolean {
  return scrollTop < prevScrollTop - USER_SCROLL_UP_TOLERANCE_PX;
}

/**
 * Rearme do follow por proximidade do fundo (comportamento legado do
 * handleScroll). Bloqueado enquanto houver espaçador: com ele, "estar perto
 * do fundo" é artificial (o fundo é espaço vazio reservado) e rearmaria o
 * follow por acidente durante a fase de âncora.
 */
export function canRearmFollow(params: {
  distanceToBottom: number;
  spacerHeight: number;
}): boolean {
  if (params.spacerHeight > SPACER_EPSILON_PX) return false;
  return params.distanceToBottom < FOLLOW_REARM_DISTANCE_PX;
}

/**
 * Decide a visibilidade do CTA sem confundi-la com o follow automático.
 *
 * Uma âncora programática pode deixar o viewport longe do fim durante todo o
 * turno, mas isso não representa intenção do usuário. O CTA só é armado por uma
 * rolagem deliberada para cima e permanece até o retorno ao fim começar ou a
 * distância ficar abaixo do limiar visual.
 */
export function nextScrollLatestVisibility(params: {
  current: boolean;
  distanceToBottom: number;
  userScrolledUp: boolean;
  returningToEnd: boolean;
}): boolean {
  if (params.returningToEnd) return false;
  if (params.distanceToBottom < SCROLL_LATEST_SHOW_DISTANCE_PX) return false;
  return params.current || params.userScrolledUp;
}
