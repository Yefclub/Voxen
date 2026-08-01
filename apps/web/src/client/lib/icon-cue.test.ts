import { describe, expect, test } from 'bun:test';
import {
  createCueQueue,
  createIconCueController,
  ICON_CUE_DURATION,
  ICON_CUE_HOLD_MS,
  ICON_CUE_PANEL_DELAY_MS,
  ICON_CUE_STAGGER_MS,
  iconCueSchedule,
  type CueScheduler,
  type IconCueHandle,
} from './icon-cue';

/**
 * Relógio controlado. A fila recebe o agendador por injeção, então dá para
 * avançar o tempo passo a passo sem DOM, sem timers reais e sem `setTimeout`
 * global remendado.
 */
function fakeClock(): {
  schedule: CueScheduler;
  advance: (ms: number) => void;
  pending: () => number;
} {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { at: number; run: () => void }>();

  const schedule: CueScheduler = (run, delayMs) => {
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
      const [id, task] = due;
      tasks.delete(id);
      now = task.at;
      task.run();
    }
    now = target;
  };

  return { schedule, advance, pending: () => tasks.size };
}

/** Handle de ícone que registra a sequência de chamadas recebidas. */
function spyHandle(name: string, log: string[]): IconCueHandle {
  return {
    startAnimation: () => log.push(`${name}:start`),
    stopAnimation: () => log.push(`${name}:stop`),
  };
}

describe('agenda das deixas de ícone', () => {
  test('escalona os ícones em cascata a partir do atraso base', () => {
    const schedule = iconCueSchedule(3, 100);

    expect(schedule.map((step) => step.startAt)).toEqual([
      100,
      100 + ICON_CUE_STAGGER_MS,
      100 + 2 * ICON_CUE_STAGGER_MS,
    ]);
  });

  test('cada ícone volta ao repouso depois de completar o desenho', () => {
    for (const step of iconCueSchedule(4)) {
      expect(step.stopAt - step.startAt).toBe(ICON_CUE_HOLD_MS);
      // O pacote roda as transições internas em até 0.9x `duration`; o hold
      // precisa cobrir isso com folga, senão o ícone corta no meio.
      expect(step.stopAt - step.startAt).toBeGreaterThan(ICON_CUE_DURATION * 1000);
    }
  });

  test('lida com grupos vazios sem agendar nada', () => {
    expect(iconCueSchedule(0)).toEqual([]);
    expect(iconCueSchedule(-3)).toEqual([]);
  });

  test('mantém o gesto curto o bastante para ler como pontuação', () => {
    // Padrão do pacote é 1s — uma deixa mais longa que isso vira performance.
    expect(ICON_CUE_DURATION).toBeLessThan(1);
    // Um pouco mais apertado que o stagger de 55ms do PageShell (alvos menores).
    expect(ICON_CUE_STAGGER_MS).toBeLessThan(55);
    // Uma varredura de 12 itens da sidebar não pode se arrastar.
    const sweep = iconCueSchedule(12, ICON_CUE_PANEL_DELAY_MS);
    expect(sweep.at(-1)?.startAt).toBeLessThan(1000);
  });
});

describe('fila de timers da deixa', () => {
  test('dispara cada tarefa no seu prazo', () => {
    const clock = fakeClock();
    const queue = createCueQueue(clock.schedule);
    const log: string[] = [];

    queue.schedule([
      { at: 50, run: () => log.push('a') },
      { at: 10, run: () => log.push('b') },
    ]);

    clock.advance(9);
    expect(log).toEqual([]);
    clock.advance(1);
    expect(log).toEqual(['b']);
    clock.advance(40);
    expect(log).toEqual(['b', 'a']);
  });

  test('uma deixa nova cancela a anterior em vez de empilhar', () => {
    const clock = fakeClock();
    const queue = createCueQueue(clock.schedule);
    const log: string[] = [];

    queue.schedule([{ at: 100, run: () => log.push('velha') }]);
    clock.advance(20);
    queue.schedule([{ at: 100, run: () => log.push('nova') }]);
    clock.advance(500);

    expect(log).toEqual(['nova']);
  });

  test('clearAll cancela tudo o que ainda não disparou', () => {
    const clock = fakeClock();
    const queue = createCueQueue(clock.schedule);
    const log: string[] = [];

    queue.schedule([
      { at: 10, run: () => log.push('a') },
      { at: 300, run: () => log.push('b') },
    ]);
    clock.advance(50);
    queue.clearAll();
    clock.advance(1000);

    expect(log).toEqual(['a']);
    expect(clock.pending()).toBe(0);
  });

  test('tarefa que disparou sai da fila', () => {
    const clock = fakeClock();
    const queue = createCueQueue(clock.schedule);

    queue.schedule([
      { at: 10, run: () => {} },
      { at: 20, run: () => {} },
    ]);
    expect(queue.size()).toBe(2);
    clock.advance(10);
    expect(queue.size()).toBe(1);
    clock.advance(10);
    expect(queue.size()).toBe(0);
  });
});

describe('grupo de ícones', () => {
  test('varre os ícones registrados em cascata e devolve cada um ao repouso', () => {
    const clock = fakeClock();
    const group = createIconCueController(clock.schedule);
    const log: string[] = [];

    group.registerIcon('um')(spyHandle('um', log));
    group.registerIcon('dois')(spyHandle('dois', log));
    group.play(true, 100);

    clock.advance(99);
    expect(log).toEqual([]);
    clock.advance(1);
    expect(log).toEqual(['um:start']);
    clock.advance(ICON_CUE_STAGGER_MS);
    expect(log).toEqual(['um:start', 'dois:start']);
    clock.advance(ICON_CUE_HOLD_MS);
    expect(log).toEqual(['um:start', 'dois:start', 'um:stop', 'dois:stop']);
  });

  test('o segundo ícone espera o stagger — a cascata não sai toda junta', () => {
    const clock = fakeClock();
    const group = createIconCueController(clock.schedule);
    const log: string[] = [];

    group.registerIcon('um')(spyHandle('um', log));
    group.registerIcon('dois')(spyHandle('dois', log));
    group.play(true, 0);

    clock.advance(ICON_CUE_STAGGER_MS - 1);
    expect(log).toEqual(['um:start']);
  });

  test('a mesma chave sempre devolve o mesmo setter de ref', () => {
    const group = createIconCueController(fakeClock().schedule);

    // Uma ref-callback nova a cada render faz o React desanexar e reanexar o
    // handle a cada ciclo — o ícone some do grupo no meio da deixa.
    expect(group.registerIcon('nav')).toBe(group.registerIcon('nav'));
    expect(group.registerIcon('nav')).not.toBe(group.registerIcon('outro'));
  });

  test('ícone que desmontou entre agendar e disparar não é animado', () => {
    const clock = fakeClock();
    const group = createIconCueController(clock.schedule);
    const log: string[] = [];
    const register = group.registerIcon('um');

    register(spyHandle('um', log));
    group.play(true, 0);
    // React chama o setter com `null` no unmount do ícone.
    register(null);
    clock.advance(5000);

    expect(log).toEqual([]);
  });

  test('dispose cancela a deixa em andamento', () => {
    const clock = fakeClock();
    const group = createIconCueController(clock.schedule);
    const log: string[] = [];

    group.registerIcon('um')(spyHandle('um', log));
    group.play(true, 100);
    clock.advance(150);
    group.dispose();
    clock.advance(5000);

    // Começou, mas o `stop` pendente foi cancelado junto com o grupo.
    expect(log).toEqual(['um:start']);
    expect(clock.pending()).toBe(0);
  });

  test('uma deixa nova substitui a anterior em vez de somar', () => {
    const clock = fakeClock();
    const group = createIconCueController(clock.schedule);
    const log: string[] = [];

    group.registerIcon('um')(spyHandle('um', log));
    group.play(true, 100);
    clock.advance(50);
    group.play(true, 100);
    clock.advance(1000);

    expect(log).toEqual(['um:start', 'um:stop']);
  });

  test('movimento reduzido não agenda nada e ainda cancela o que estava pendente', () => {
    const clock = fakeClock();
    const group = createIconCueController(clock.schedule);
    const log: string[] = [];

    group.registerIcon('um')(spyHandle('um', log));
    group.play(true, 100);
    group.play(false, 100);
    clock.advance(5000);

    expect(log).toEqual([]);
    expect(clock.pending()).toBe(0);
  });
});
