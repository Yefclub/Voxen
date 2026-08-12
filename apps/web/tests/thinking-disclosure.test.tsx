import React, { useEffect } from 'react';
import { describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  THINKING_AUTO_CLOSE_DELAY_MS,
  initialThinkingDisclosure,
  thinkingDisclosureReducer,
  useThinkingDisclosure,
  type DisclosureScheduler,
  type ThinkingDisclosureEvent,
} from '../src/client/lib/thinking-disclosure';
import {
  applySegmentEvent,
  closeTrailingReasoning,
  type MessageSegment,
} from '../src/client/lib/chat-segments';

// O defeito da spec 130 é de CICLO DE VIDA: `expanded` mudava de valor no meio
// do turno. Só um teste que roda a sequência inteira de um turno agêntico e
// olha a lista de transições distingue "abriu uma vez e fechou uma vez" de
// "abriu e fechou a cada ferramenta" — asserção sobre um instante isolado
// passa nos dois. Mesmo instrumental de `icon-cue-lifecycle`.
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** Relógio controlado no lugar do `setTimeout` do atraso pós-turno. */
function fakeClock(): {
  schedule: DisclosureScheduler;
  advance: (ms: number) => void;
  pending: () => number;
} {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { at: number; run: () => void }>();

  const schedule: DisclosureScheduler = (run, delayMs) => {
    const id = nextId++;
    tasks.set(id, { at: now + delayMs, run });
    return () => {
      tasks.delete(id);
    };
  };

  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      tasks.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = target;
  };

  return { schedule, advance, pending: () => tasks.size };
}

/** Um instante do turno, com a mesma forma das props de `ThinkingBlock`. */
type TurnFrame = { segments: MessageSegment[]; live: boolean; answering: boolean };

/**
 * Início, meio e fim do turno em campos nomeados — nada de indexar o array e
 * carregar `| undefined` por todo o teste.
 */
type AgenticTurn = { start: TurnFrame; middle: TurnFrame[]; ended: TurnFrame };

/**
 * A sequência que o owner descreveu: o harness raciocina, começa a responder,
 * chama ferramenta, volta a responder e o stream fecha. Construída com o
 * `applySegmentEvent` de verdade — não com segmentos escritos à mão — para que
 * o teste veja os mesmos dados que a página vê.
 */
function agenticTurn(): AgenticTurn {
  let segments: MessageSegment[] = [];
  const frame = (live: boolean, answering: boolean): TurnFrame => ({ segments, live, answering });

  // 1. Raciocínio, ainda sem uma palavra da resposta final.
  segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'analisando' }, 1_000);
  const start = frame(true, false);

  // 2. Primeiro pedaço da resposta chega — a página carimba o fim do
  // raciocínio corrente, como faz no `delta` de texto.
  segments = closeTrailingReasoning(segments, 1_500);
  const answering = frame(true, true);

  // 3. O harness resolve chamar mais uma ferramenta no meio da resposta.
  segments = applySegmentEvent(
    segments,
    { type: 'tool', tool: { id: 't1', name: 'search_transcripts', state: 'running' } },
    2_000,
  );
  const calling = frame(true, true);

  // 4. Ferramenta responde e o texto volta a fluir.
  segments = applySegmentEvent(
    segments,
    { type: 'tool', tool: { id: 't1', name: 'search_transcripts', state: 'completed' } },
    3_000,
  );
  const answeringAgain = frame(true, true);

  // 5. Stream fechado.
  return { start, middle: [answering, calling, answeringAgain], ended: frame(false, true) };
}

/** Os cinco quadros na ordem em que o usuário os vê. */
function turnFrames(turn: AgenticTurn): TurnFrame[] {
  return [turn.start, ...turn.middle, turn.ended];
}

/**
 * O gatilho que a spec 130 aposentou (`thinkingInFlight` + os `segmentsRunning`
 * / `toolBlockState` que ele consumia, todos removidos junto), reproduzido
 * INTEIRO aqui só para provar que a sequência acima é a patológica. É de
 * propósito que o teste não importe nada disso da produção: a produção não tem
 * mais — é exatamente esse o conserto — e um helper que sobrevivesse lá só para
 * este teste seria código morto com respiração assistida.
 */
function retiredTrigger(frame: TurnFrame): boolean {
  if (!frame.live) return false;
  if (!frame.answering) return true;
  return frame.segments.some((segment) =>
    segment.type === 'reasoning'
      ? segment.endedAt == null
      : // Aprovação pendente não contava como `running`: o HITL vive acima do
        // composer, fora do bloco "Pensando" (spec 090).
        segment.tools.some((tool) => tool.state === 'running'),
  );
}

type Probe = { toggle: () => void };

/**
 * Espelha a ligação real do `ThinkingBlock`: recebe o quadro do turno e passa
 * ao hook exatamente o que a página passa. O log guarda só as MUDANÇAS de
 * `expanded` já comitadas, então o seu comprimento é a contagem de saltos que
 * o usuário enxerga.
 */
function DisclosureProbe({
  frame,
  schedule,
  log,
  probe,
}: {
  frame: TurnFrame;
  schedule: DisclosureScheduler;
  log: boolean[];
  probe: Probe;
}): React.ReactElement | null {
  const { expanded, toggle } = useThinkingDisclosure(frame.live, frame.answering, schedule);
  probe.toggle = toggle;
  useEffect(() => {
    if (log.length === 0 || log[log.length - 1] !== expanded) log.push(expanded);
  }, [expanded, log]);
  return null;
}

async function mount(
  frame: TurnFrame,
  schedule: DisclosureScheduler,
  log: boolean[],
  probe: Probe,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(DisclosureProbe, { frame, schedule, log, probe }));
  });
  return renderer;
}

async function step(
  renderer: ReactTestRenderer,
  frame: TurnFrame,
  schedule: DisclosureScheduler,
  log: boolean[],
  probe: Probe,
): Promise<void> {
  await act(async () => {
    renderer.update(React.createElement(DisclosureProbe, { frame, schedule, log, probe }));
  });
}

describe('bloco de raciocínio durante um turno agêntico', () => {
  test('o gatilho antigo realmente oscila dentro do turno', () => {
    // Guarda do próprio teste: se um dia a sequência deixar de ser patológica,
    // os testes abaixo passariam sem provar nada. Enquanto o gatilho aposentado
    // alternar nesta sequência, o cenário continua sendo o que o owner relatou
    // — e `live`, que a substitui, é constante ao longo do turno.
    const frames = turnFrames(agenticTurn());
    expect(frames.map(retiredTrigger)).toEqual([true, false, true, false, false]);
    expect(frames.map((frame) => frame.live)).toEqual([true, true, true, true, false]);
    // A premissa do gatilho da spec 200: `answering` é MONÓTONO. É por isso que
    // ele pode recolher sem trazer de volta a oscilação — ao contrário do
    // gatilho aposentado acima, que alterna nos dois sentidos nesta mesma
    // sequência.
    expect(frames.map((frame) => frame.answering)).toEqual([false, true, true, true, true]);
  });

  test('o atraso do recolhimento é perceptível sem ser espera', () => {
    // As demais asserções de tempo são relativas à própria constante, então
    // passariam com `0` (recolhimento no mesmo frame, o salto que a spec veio
    // remover) ou com um minuto. Este é o único ponto que prende a magnitude.
    expect(THINKING_AUTO_CLOSE_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(THINKING_AUTO_CLOSE_DELAY_MS).toBeLessThanOrEqual(2_000);
  });

  test('abre uma vez e recolhe uma vez, na chegada da resposta (spec 200)', async () => {
    // A propriedade que a spec 130 conquistou — uma abertura, um recolhimento,
    // sem salto por ferramenta — continua valendo. O que a spec 200 muda é o
    // INSTANTE do recolhimento: quando a resposta começa, não quando o turno
    // acaba. Por isso o log de transições é a asserção certa: ele distingue
    // "recolheu uma vez, cedo" de "recolheu a cada ida-e-volta".
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    expect(log).toEqual([true]);

    // Primeiro pedaço da resposta: recolhe na hora, sem esperar o turno.
    const [answering, calling, answeringAgain] = turn.middle;
    await step(renderer, answering!, clock.schedule, log, probe);
    expect(log).toEqual([true, false]);
    expect(clock.pending()).toBe(0);

    // Ferramenta no meio da resposta e o texto voltando a fluir: a trava
    // segura. Reabrir aqui seria a oscilação que a spec 130 removeu.
    await step(renderer, calling!, clock.schedule, log, probe);
    await step(renderer, answeringAgain!, clock.schedule, log, probe);
    expect(log).toEqual([true, false]);

    // Fim do turno não mexe mais em nada — já está recolhido, e o agendamento
    // pós-turno só existe para o turno que termina sem texto final.
    await step(renderer, turn.ended, clock.schedule, log, probe);
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  test('turno que termina só com ferramentas ainda recolhe pelo atraso', async () => {
    // Sem texto final, `answerStarted` nunca fica verdadeiro, então o caminho
    // da spec 130 continua sendo o único que fecha o bloco.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };

    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'analisando' }, 1_000);
    segments = applySegmentEvent(
      segments,
      { type: 'tool', tool: { id: 't1', name: 'list_transcripts', state: 'completed' } },
      2_000,
    );
    const running: TurnFrame = { segments, live: true, answering: false };
    const ended: TurnFrame = { segments, live: false, answering: false };

    const renderer = await mount(running, clock.schedule, log, probe);
    expect(log).toEqual([true]);

    await step(renderer, ended, clock.schedule, log, probe);
    expect(log).toEqual([true]);

    act(() => clock.advance(THINKING_AUTO_CLOSE_DELAY_MS - 1));
    expect(log).toEqual([true]);

    act(() => clock.advance(1));
    expect(log).toEqual([true, false]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  test('montar com a resposta já em curso nasce recolhido, sem pisca', async () => {
    // O bloco só monta com `segments.length > 0` (`chat.tsx`), e no cliente o
    // texto vai para `content` enquanto raciocínio e ferramenta vão para
    // `segments`. Turno que responde ANTES de chamar a primeira ferramenta
    // monta o bloco tarde, já com `live` e `answerStarted` verdadeiros.
    //
    // Este é o único teste em forma de produção da ligação do inicializador:
    // os testes do reducer provam a função, não que o hook a alimenta com o
    // `answerStarted` real. Sem isso, montar aberto para recolher no efeito
    // seguinte devolve o frame de pisca.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const [answering] = agenticTurn().middle;

    const renderer = await mount(answering!, clock.schedule, log, probe);
    expect(log).toEqual([false]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  test('queda e volta do stream depois da resposta não reabre o bloco', async () => {
    // `live` voltando a ser verdadeiro dispara `turn-started` de novo. Sem a
    // trava, isso reabriria um bloco que a resposta já recolheu.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();
    const [answering] = turn.middle;

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    await step(renderer, answering!, clock.schedule, log, probe);
    expect(log).toEqual([true, false]);

    // Stream cai…
    await step(renderer, { ...answering!, live: false }, clock.schedule, log, probe);
    // …e volta, no MESMO turno (mesma instância do componente).
    await step(renderer, answering!, clock.schedule, log, probe);

    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  test('bloco aberto à mão não é fechado pela chegada da resposta', async () => {
    // O usuário abriu para ler o raciocínio. Recolher por baixo dele quando a
    // resposta começa é o mesmo atropelo que a spec 130 removeu do fim do turno.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    await act(async () => probe.toggle()); // fecha
    await act(async () => probe.toggle()); // reabre, agora por decisão dele
    expect(log).toEqual([true, false, true]);

    for (const frame of [...turn.middle, turn.ended]) {
      await step(renderer, frame, clock.schedule, log, probe);
    }
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false, true]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  test('clique depois da trava mantém o controle do usuário', async () => {
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();
    const [answering, calling] = turn.middle;

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    await step(renderer, answering!, clock.schedule, log, probe);
    expect(log).toEqual([true, false]);

    // Reabre depois de a resposta já ter recolhido.
    await act(async () => probe.toggle());
    expect(log).toEqual([true, false, true]);

    // Nem a ferramenta seguinte, nem o fim do turno, tomam de volta.
    await step(renderer, calling!, clock.schedule, log, probe);
    await step(renderer, turn.ended, clock.schedule, log, probe);
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false, true]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  // ==========================================================================
  // Contrato do reducer, sem React no meio.
  //
  // Os testes de ciclo de vida acima passam pelo `useEffect`, e ali `live` está
  // nos dois arrays de dependência: `turn-started` e `answer-started` caem no
  // mesmo lote, então o `expanded: true` intermediário nunca é comitado e o log
  // de transições fica igual COM ou SEM a trava. Ou seja, aqueles testes
  // provariam a ordem de declaração dos efeitos, não a garantia.
  //
  // A trava é a garantia que a spec 200 mais destaca. Sobre o reducer puro ela
  // é verificável diretamente, e o teste falha se alguém tirar `answered` da
  // guarda — inclusive se antes disso trocar a ordem dos efeitos.
  // ==========================================================================
  describe('reducer', () => {
    const run = (
      events: ThinkingDisclosureEvent[],
      start = initialThinkingDisclosure({ live: true, answerStarted: false }),
    ) => events.reduce(thinkingDisclosureReducer, start);

    test('a resposta recolhe e trava contra reabertura automática', () => {
      const afterAnswer = run([{ type: 'answer-started' }]);
      expect(afterAnswer.expanded).toBe(false);
      expect(afterAnswer.answered).toBe(true);

      // O caso que o teste de ciclo de vida não alcança: `turn-started` DEPOIS
      // da resposta — stream que cai e volta no mesmo turno.
      const afterRecovery = thinkingDisclosureReducer(afterAnswer, { type: 'turn-started' });
      expect(afterRecovery.expanded).toBe(false);
      // Identidade de referência de propósito, não descuido: é ela que faz o
      // `useReducer` desistir do re-render (`Object.is`). Trocar por `toEqual`
      // deixaria passar um `return { ...state }` que custa um render por
      // recuperação de stream.
      expect(afterRecovery).toBe(afterAnswer);
    });

    // Ferramenta no meio do turno não gera evento nenhum nesta máquina — `live`
    // continua verdadeiro e o efeito não re-dispara. Quem cobre aquele caso é o
    // teste de ciclo de vida acima. `turn-started` repetido é queda-e-volta de
    // stream, e o que se prova aqui é que repetir não desfaz a trava.
    test('`turn-started` repetido depois da resposta não reabre', () => {
      const state = run([
        { type: 'answer-started' },
        { type: 'turn-started' },
        { type: 'turn-started' },
      ]);
      expect(state.expanded).toBe(false);
    });

    test('o controle manual vence a chegada da resposta', () => {
      const opened = run([{ type: 'toggled' }, { type: 'toggled' }]);
      expect(opened).toMatchObject({ expanded: true, manual: true });

      const afterAnswer = thinkingDisclosureReducer(opened, { type: 'answer-started' });
      expect(afterAnswer.expanded).toBe(true);
      // Marca a trava mesmo sob controle manual: se o usuário devolver o bloco
      // ao automático num turno futuro, o turno não pode parecer "sem resposta".
      expect(afterAnswer.answered).toBe(true);
    });

    test('turno só com ferramentas fecha pelo auto-close, sem travar', () => {
      const state = run([{ type: 'auto-close' }]);
      expect(state).toMatchObject({ expanded: false, answered: false });
    });

    test('o estado inicial já nasce coerente com a resposta em curso', () => {
      expect(initialThinkingDisclosure({ live: true, answerStarted: false })).toMatchObject({
        expanded: true,
        answered: false,
      });
      // Montar no meio de uma resposta: recolhido e travado, sem abrir para
      // fechar no efeito seguinte.
      expect(initialThinkingDisclosure({ live: true, answerStarted: true })).toMatchObject({
        expanded: false,
        answered: true,
      });
      expect(initialThinkingDisclosure({ live: false, answerStarted: true })).toMatchObject({
        expanded: false,
        answered: true,
      });
    });
  });

  test('clicar durante o turno tira o bloco do piloto automático', async () => {
    // O caso que importa é o usuário deixando o bloco ABERTO por decisão
    // própria: aí o recolhimento do fim do turno é a diferença entre respeitar
    // a escolha dele e fechar a leitura na cara dele.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    await act(async () => probe.toggle());
    await act(async () => probe.toggle());
    expect(log).toEqual([true, false, true]);

    // Resto do turno: nada mexe no que o usuário escolheu…
    for (const frame of [...turn.middle, turn.ended]) {
      await step(renderer, frame, clock.schedule, log, probe);
    }
    // …nem o recolhimento automático do fim do turno.
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false, true]);
    expect(clock.pending()).toBe(0);

    // E fechar continua sendo do usuário, sem a automação reagir depois.
    await act(async () => probe.toggle());
    expect(log).toEqual([true, false, true, false]);
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false, true, false]);

    await act(async () => renderer.unmount());
  });

  test('queda e volta do stream não atropelam quem já clicou', async () => {
    // Uma instância = um turno (a `<article>` é chaveada pelo id da mensagem),
    // então `live` voltando a ser verdadeiro é SEMPRE o mesmo turno se
    // recuperando — nunca um turno novo. Tratar isso como recomeço devolveria
    // o bloco à automação no meio do caminho.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    await act(async () => probe.toggle());
    expect(log).toEqual([true, false]);

    // Queda longa o bastante para o recolhimento automático vencer, e volta.
    await step(renderer, turn.ended, clock.schedule, log, probe);
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    await step(renderer, turn.start, clock.schedule, log, probe);
    expect(log).toEqual([true, false]);

    // Encerrando de vez, continua sem a automação encostar no bloco.
    await step(renderer, turn.ended, clock.schedule, log, probe);
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
  });

  test('sem clique do usuário, a volta do stream reabre o bloco', async () => {
    // Mesmo caminho, sem o clique: aí a automação continua no comando, e é ela
    // que reabre — inclusive no turno restaurado depois de recarregar a página,
    // que monta com o stream ainda fechado.
    //
    // O quadro de montagem é o turno restaurado ANTES da resposta, e não
    // `turn.ended`: o servidor grava `content` uma única vez, no fim do turno,
    // e durante `RUNNING` o snapshot devolve string vazia. Turno vivo restaurado
    // com a resposta inteira pronta não existe. Com a trava da spec 200 a
    // diferença passou a importar — depois da resposta, a volta do stream não
    // reabre mais (é o que o teste do reducer cobre).
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();
    const restored: TurnFrame = { ...turn.start, live: false };

    const renderer = await mount(restored, clock.schedule, log, probe);
    expect(log).toEqual([false]);

    await step(renderer, turn.start, clock.schedule, log, probe);
    expect(log).toEqual([false, true]);

    await step(renderer, turn.ended, clock.schedule, log, probe);
    act(() => clock.advance(THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([false, true, false]);

    await act(async () => renderer.unmount());
  });
});

describe('mensagem já concluída', () => {
  test('monta recolhida, sem agendar recolhimento nenhum', async () => {
    // Toda mensagem antiga da conversa monta com `live` falso. Agendar um
    // timer por mensagem para fechar o que já está fechado seria desperdício
    // proporcional ao tamanho do histórico.
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };

    const renderer = await mount(agenticTurn().ended, clock.schedule, log, probe);
    expect(log).toEqual([false]);
    expect(clock.pending()).toBe(0);

    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([false]);

    // E continua abrindo no clique — é como se lê o raciocínio de um turno
    // antigo.
    await act(async () => probe.toggle());
    expect(log).toEqual([false, true]);

    await act(async () => renderer.unmount());
  });
});
