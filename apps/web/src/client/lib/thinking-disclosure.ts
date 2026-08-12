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
//      (`manual`) pelo resto daquele turno.
//
// A spec 200 corrigiu QUANDO o recolhimento acontece. Amarrado só a `live`, ele
// esperava o turno inteiro terminar, então a timeline de raciocínio ficava por
// cima da resposta durante todo o streaming dela — exatamente o conteúdo que
// importa empurrado para baixo. Agora o primeiro pedaço da resposta recolhe o
// bloco, e o ponto 2 acima permanece como caminho do turno que termina só com
// ferramentas, sem texto final nenhum.
//
// O ponto 3 vale inclusive para o recolhimento do fim do turno: fechar por
// baixo de quem abriu o bloco para ler é exatamente o salto que esta spec veio
// remover. É a regra específica ("parar de controlá-lo automaticamente")
// prevalecendo sobre a geral ("recolher ao fim do turno"). E "aquele turno" é
// o tempo de vida do componente: a `<article>` da mensagem é chaveada pelo id,
// então turno novo já nasce com estado limpo.
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
  /** A resposta final já começou neste turno. Trava de uma via (spec 200). */
  readonly answered: boolean;
};

export type ThinkingDisclosureEvent =
  /** O stream do turno abriu. */
  | { type: 'turn-started' }
  /** Chegou o primeiro pedaço da resposta final (spec 200). */
  | { type: 'answer-started' }
  /** Venceu o atraso depois que o stream fechou. */
  | { type: 'auto-close' }
  /** O usuário clicou no cabeçalho. */
  | { type: 'toggled' };

/**
 * Turno já vivo na montagem abre direto; mensagem do histórico monta recolhida
 * — e recolhida ela nunca agenda nada, senão cada mensagem antiga da conversa
 * armaria um timer para fechar o que já está fechado.
 *
 * Montar com a resposta já em curso nasce recolhido e já travado. Abrir para
 * recolher no efeito seguinte seria um frame de pisca, e um `turn-started`
 * posterior encontraria o turno "sem resposta" e reabriria.
 */
export function initialThinkingDisclosure({
  live,
  answerStarted,
}: {
  live: boolean;
  answerStarted: boolean;
}): ThinkingDisclosureState {
  return { expanded: live && !answerStarted, manual: false, answered: answerStarted };
}

export function thinkingDisclosureReducer(
  state: ThinkingDisclosureState,
  event: ThinkingDisclosureEvent,
): ThinkingDisclosureState {
  switch (event.type) {
    case 'turn-started':
      // Uma instância = um turno: o bloco vive dentro da `<article>` chaveada
      // pelo id da mensagem, e turno novo é mensagem nova, logo componente
      // novo (com `manual` zerado pela montagem). Então um `live` que volta a
      // ser verdadeiro AQUI é o mesmo turno se recuperando de uma queda de
      // stream — e reabrir o bloco nesse caso atropelaria quem já clicou, ou
      // desfaria o recolhimento que a resposta já provocou.
      if (state.manual || state.answered) return state;
      return { ...state, expanded: true };
    case 'answer-started':
      // Trava de uma via: marca `answered` mesmo sob controle manual, para que
      // nenhuma reabertura automática posterior encontre o turno "sem resposta".
      if (state.manual) return { ...state, answered: true };
      return { ...state, expanded: false, answered: true };
    case 'auto-close':
      return { ...state, expanded: false };
    case 'toggled':
      return { ...state, expanded: !state.expanded, manual: true };
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
 * Dois gatilhos automáticos, e a distinção entre eles é o que a spec 130 não
 * tinha: `live` abre no começo do turno, `answerStarted` recolhe UMA vez quando
 * o primeiro pedaço da resposta chega.
 *
 * O que quebrou na spec 126 foi o vínculo BIDIRECIONAL a `thinkingInFlight`,
 * que alterna nos dois sentidos dentro do turno (abre no raciocínio, fecha no
 * texto, abre de novo na próxima ferramenta) — um ciclo por ida-e-volta. Uma
 * trava de uma via não oscila: depois que a resposta começou, `answered` impede
 * qualquer reabertura automática pelo resto do turno, inclusive se o harness
 * chamar mais ferramentas ou o stream cair e voltar. Por isso `answerStarted`
 * pode ser gatilho e `thinkingInFlight` não podia.
 */
export function useThinkingDisclosure(
  live: boolean,
  answerStarted: boolean,
  schedule: DisclosureScheduler = timeoutScheduler,
): { expanded: boolean; toggle: () => void } {
  const [state, dispatch] = useReducer(
    thinkingDisclosureReducer,
    { live, answerStarted },
    initialThinkingDisclosure,
  );
  const { expanded, manual } = state;

  useEffect(() => {
    if (live) dispatch({ type: 'turn-started' });
  }, [live]);

  useEffect(() => {
    // Só num turno vivo: mensagem do histórico chega com a resposta inteira
    // pronta e já monta recolhida — disparar aqui seria recolher o que já está
    // recolhido e sujar o log de transições.
    if (live && answerStarted) dispatch({ type: 'answer-started' });
  }, [live, answerStarted]);

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
