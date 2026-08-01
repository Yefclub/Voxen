// ============================================================================
// Abertura e fechamento do bloco "Pensando" (spec 130, item 1)
// ----------------------------------------------------------------------------
// Antes desta spec o bloco amarrava `expanded` a `thinkingInFlight`, que oscila
// DENTRO do mesmo turno: sem texto → em voo (abre); chegou o primeiro pedaço da
// resposta → fora de voo (fecha); o harness chama outra ferramenta → em voo de
// novo (abre)… Um ciclo abre/fecha por ida-e-volta de ferramenta, que é a
// "interface pulando" relatada pelo owner.
//
// O gatilho correto é `live` (o stream do turno está aberto?), que não oscila
// no meio do turno. Em cima dele, três garantias — as mesmas do `Reasoning` do
// `vercel/ai-elements`, que resolve o mesmo problema:
//
//   1. abre UMA vez, quando o turno começa;
//   2. recolhe UMA vez, com atraso curto depois que o stream fecha
//      (`THINKING_AUTO_CLOSE_DELAY_MS`) — recolher no mesmo frame em que a
//      resposta aparece é mais um salto de layout;
//   3. se o usuário acionou o cabeçalho, a automação larga o controle
//      (`manual`) e só o retoma no turno seguinte.
//
// O ponto 3 vale inclusive para o recolhimento do fim do turno: fechar por
// baixo de quem abriu o bloco para ler é exatamente o salto que esta spec veio
// remover. É a regra específica ("parar de controlá-lo automaticamente")
// prevalecendo sobre a geral ("recolher ao fim do turno").
//
// A máquina é pura e o agendador é injetável, então a sequência real de um
// turno agêntico é exercitável em teste sem DOM e sem timer de verdade.
// ============================================================================

import { useCallback, useEffect, useReducer } from 'react';

/**
 * Atraso entre o fim do turno e o recolhimento. Curto o bastante para não
 * parecer travado, longo o bastante para o olho registrar que o bloco fechou
 * em vez de a resposta ter "pulado" para cima.
 */
export const THINKING_AUTO_CLOSE_DELAY_MS = 1000;

export type ThinkingDisclosureState = {
  /** O bloco está aberto? É o que a UI consome. */
  readonly expanded: boolean;
  /** O usuário acionou o cabeçalho neste turno — a automação parou. */
  readonly manual: boolean;
};

export type ThinkingDisclosureEvent =
  /** O stream do turno abriu. */
  | { type: 'turn-started' }
  /** Venceu o atraso depois que o stream fechou. */
  | { type: 'auto-close' }
  /** O usuário clicou no cabeçalho. */
  | { type: 'toggled' };

/**
 * Turno já vivo na montagem abre direto; mensagem do histórico monta recolhida
 * — e recolhida ela nunca agenda nada, senão cada mensagem antiga da conversa
 * armaria um timer para fechar o que já está fechado.
 */
export function initialThinkingDisclosure(live: boolean): ThinkingDisclosureState {
  return { expanded: live, manual: false };
}

export function thinkingDisclosureReducer(
  state: ThinkingDisclosureState,
  event: ThinkingDisclosureEvent,
): ThinkingDisclosureState {
  switch (event.type) {
    case 'turn-started':
      // O turno novo devolve o controle à automação: o override manual vale só
      // para o turno em que o clique aconteceu — o "até o fim daquele turno"
      // da spec.
      return { expanded: true, manual: false };
    case 'auto-close':
      return { ...state, expanded: false };
    case 'toggled':
      return { expanded: !state.expanded, manual: true };
  }
}

/**
 * Agenda `run` para daqui a `delayMs` e devolve o cancelamento. Injetável para
 * o teste rodar com relógio controlado (mesmo padrão de `icon-cue`).
 */
export type DisclosureScheduler = (run: () => void, delayMs: number) => () => void;

const timeoutScheduler: DisclosureScheduler = (run, delayMs) => {
  const id = setTimeout(run, delayMs);
  return () => clearTimeout(id);
};

/**
 * Estado de abertura do bloco "Pensando" de um turno.
 *
 * `live` é o único gatilho automático, de propósito: qualquer sinal que mude no
 * meio do turno (a resposta começando, uma ferramenta entrando) traz de volta a
 * oscilação que a spec 130 corrigiu.
 */
export function useThinkingDisclosure(
  live: boolean,
  schedule: DisclosureScheduler = timeoutScheduler,
): { expanded: boolean; toggle: () => void } {
  const [state, dispatch] = useReducer(thinkingDisclosureReducer, live, initialThinkingDisclosure);
  const { expanded, manual } = state;

  useEffect(() => {
    if (live) dispatch({ type: 'turn-started' });
  }, [live]);

  useEffect(() => {
    // Só há o que recolher com o turno encerrado, o bloco aberto e a automação
    // ainda no comando. Cada uma das três condições também é o que impede o
    // agendamento de se rearmar depois de disparar.
    if (live || !expanded || manual) return;
    return schedule(() => dispatch({ type: 'auto-close' }), THINKING_AUTO_CLOSE_DELAY_MS);
  }, [live, expanded, manual, schedule]);

  const toggle = useCallback(() => dispatch({ type: 'toggled' }), []);
  return { expanded, toggle };
}
