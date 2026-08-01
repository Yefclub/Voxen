import React, { useEffect } from 'react';
import { describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  THINKING_AUTO_CLOSE_DELAY_MS,
  useThinkingDisclosure,
  type DisclosureScheduler,
} from '../src/client/lib/thinking-disclosure';
import {
  applySegmentEvent,
  closeTrailingReasoning,
  segmentsRunning,
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
 * O gatilho que a spec 130 aposentou (`thinkingInFlight`, removido junto com
 * ela), reproduzido aqui só para provar que a sequência acima é a patológica.
 * Fora do teste ele não existe mais — é exatamente esse o conserto.
 */
function retiredTrigger(frame: TurnFrame): boolean {
  if (!frame.live) return false;
  if (!frame.answering) return true;
  return segmentsRunning(frame.segments);
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
  const { expanded, toggle } = useThinkingDisclosure(frame.live, schedule);
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
  });

  test('o atraso do recolhimento é perceptível sem ser espera', () => {
    // As demais asserções de tempo são relativas à própria constante, então
    // passariam com `0` (recolhimento no mesmo frame, o salto que a spec veio
    // remover) ou com um minuto. Este é o único ponto que prende a magnitude.
    expect(THINKING_AUTO_CLOSE_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(THINKING_AUTO_CLOSE_DELAY_MS).toBeLessThanOrEqual(2_000);
  });

  test('abre uma vez e recolhe uma vez, mesmo com ferramenta no meio da resposta', async () => {
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();

    const renderer = await mount(turn.start, clock.schedule, log, probe);
    for (const frame of turn.middle) {
      await step(renderer, frame, clock.schedule, log, probe);
    }

    // Durante o turno inteiro: nenhuma mudança depois da abertura.
    expect(log).toEqual([true]);
    expect(clock.pending()).toBe(0);

    // Fim do turno: o recolhimento espera o atraso curto em vez de acontecer
    // no mesmo frame em que a resposta aparece.
    await step(renderer, turn.ended, clock.schedule, log, probe);
    expect(log).toEqual([true]);

    act(() => clock.advance(THINKING_AUTO_CLOSE_DELAY_MS - 1));
    expect(log).toEqual([true]);

    act(() => clock.advance(1));
    expect(log).toEqual([true, false]);

    // E não volta a se mexer sozinho depois disso.
    act(() => clock.advance(10 * THINKING_AUTO_CLOSE_DELAY_MS));
    expect(log).toEqual([true, false]);
    expect(clock.pending()).toBe(0);

    await act(async () => renderer.unmount());
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
    const clock = fakeClock();
    const log: boolean[] = [];
    const probe: Probe = { toggle: () => {} };
    const turn = agenticTurn();

    const renderer = await mount(turn.ended, clock.schedule, log, probe);
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
