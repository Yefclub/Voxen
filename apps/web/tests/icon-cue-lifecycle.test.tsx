import React, { forwardRef, useEffect, useImperativeHandle, type ComponentType } from 'react';
import { describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ICON_CUE_HOLD_MS,
  ICON_CUE_PANEL_DELAY_MS,
  useIconCueGroup,
  useIconCueSignal,
  useIconCueTrigger,
  type CueScheduler,
  type IconCueHandle,
} from '../src/client/lib/icon-cue';
import { PageHeader } from '../src/client/components/ui/page-shell';
import type { AnimatedIcon } from '../src/client/components/ui/icons';

// react-test-renderer já é usado por `graph-renderer-lifecycle` e
// `transcript-chat-dock`: é como este repositório testa ciclo de vida de
// componente sem DOM. As deixas de ícone dependem de efeito e de ordem de
// commit, então é aqui — não em teste de unidade puro — que os dois requisitos
// event-driven da spec 129 ficam travados.
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** Relógio controlado, injetado no grupo de deixas no lugar dos timers reais. */
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
      tasks.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = target;
  };

  return { schedule, advance, pending: () => tasks.size };
}

/** Ícone sonda: expõe o handle de animação e anota cada chamada recebida. */
function probeIcon(log: string[]): AnimatedIcon {
  return forwardRef<IconCueHandle>(function ProbeIcon(_props, ref) {
    useImperativeHandle(
      ref,
      () => ({
        startAnimation: () => log.push('start'),
        stopAnimation: () => log.push('stop'),
      }),
      [],
    );
    return null;
  }) as AnimatedIcon;
}

/**
 * Consumidor de deixa com a mesma forma do `SidebarRail` / `NavBody`: grupo de
 * ícones do componente + `useIconCueSignal` observando o sinal que chega por
 * prop. O agendador vem injetado para o relógio ser controlado pelo teste.
 */
function CuedNav({
  signal,
  scheduler,
  icon: Icon,
  onMount,
}: {
  signal: number;
  scheduler: CueScheduler;
  icon: ComponentType<React.RefAttributes<IconCueHandle>>;
  onMount?: () => void;
}): React.ReactElement {
  const { registerIcon, playCue } = useIconCueGroup(true, scheduler);
  useIconCueSignal(playCue, signal, ICON_CUE_PANEL_DELAY_MS);
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  return React.createElement(Icon, { ref: registerIcon('nav') });
}

describe('deixa de ícone ao abrir a página', () => {
  test('o ícone do cabeçalho se desenha uma vez depois da montagem', async () => {
    // Requisito event-driven da spec 129: "when o usuário abre uma página, the
    // system shall executar a animação dos ícones dessa página". Componente
    // real, ícone sonda no lugar do ícone da página, timers reais.
    const log: string[] = [];
    const Icon = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(PageHeader, {
          eyebrow: 'biblioteca',
          icon: Icon,
          title: 'Transcrições',
        }),
      );
    });

    // Nada no frame da montagem: a deixa entra depois, com o cabeçalho já
    // subindo na timeline do PageShell.
    expect(log).toEqual([]);

    await act(async () => {
      await Bun.sleep(300);
    });
    expect(log).toEqual(['start']);

    await act(async () => renderer.unmount());
  });
});

describe('deixa de ícone ao abrir e fechar a navegação', () => {
  test('alternar o colapso da sidebar pontua o painel que monta', async () => {
    // Requisito event-driven da spec 129: "when a sidebar é aberta ou fechada,
    // the system shall executar a animação dos ícones envolvidos".
    //
    // O `Sidebar` troca rail por painel no mesmo commit em que `collapsed`
    // muda, então quem monta captura o sinal AINDA ANTIGO; o incremento de
    // `useIconCueTrigger` cai no commit seguinte e é ele que dispara a deixa.
    // Derivar o sinal durante o render mataria isso em silêncio — é o que este
    // teste impede.
    const clock = fakeClock();
    const log: string[] = [];
    const Icon = probeIcon(log);

    function DesktopNav({ collapsed }: { collapsed: boolean }): React.ReactElement {
      const cueSignal = useIconCueTrigger(collapsed);
      return React.createElement(CuedNav, {
        key: collapsed ? 'rail' : 'panel',
        signal: cueSignal,
        scheduler: clock.schedule,
        icon: Icon,
      });
    }

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(DesktopNav, { collapsed: true }));
    });
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS + ICON_CUE_HOLD_MS));
    // Primeiro carregamento não pontua — aí quem pontua é o cabeçalho.
    expect(log).toEqual([]);

    await act(async () => {
      renderer.update(React.createElement(DesktopNav, { collapsed: false }));
    });
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS));
    expect(log).toEqual(['start']);
    act(() => clock.advance(ICON_CUE_HOLD_MS));
    expect(log).toEqual(['start', 'stop']);

    // E fechar pontua de novo, no rail que volta.
    await act(async () => {
      renderer.update(React.createElement(DesktopNav, { collapsed: true }));
    });
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS));
    expect(log).toEqual(['start', 'stop', 'start']);

    await act(async () => renderer.unmount());
  });

  test('no drawer mobile só a abertura pontua, e o corpo nunca remonta', async () => {
    // O corpo do drawer fica montado o tempo todo (o gesto de swipe precisa da
    // árvore pronta fora da tela), então não existe "montou" onde pendurar a
    // deixa — só o contador. Fechando, varrer ícones de um painel que está
    // saindo de cena seria desperdício.
    const clock = fakeClock();
    const log: string[] = [];
    const Icon = probeIcon(log);
    let mounts = 0;
    const countMount = (): void => {
      mounts += 1;
    };
    const onlyWhenOpen = (open: boolean): boolean => open;

    function MobileNav({ open }: { open: boolean }): React.ReactElement {
      const cueSignal = useIconCueTrigger(open, onlyWhenOpen);
      return React.createElement(CuedNav, {
        signal: cueSignal,
        scheduler: clock.schedule,
        icon: Icon,
        onMount: countMount,
      });
    }

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(MobileNav, { open: false }));
    });
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS + ICON_CUE_HOLD_MS));
    expect(log).toEqual([]);

    await act(async () => {
      renderer.update(React.createElement(MobileNav, { open: true }));
    });
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS));
    expect(log).toEqual(['start']);
    act(() => clock.advance(ICON_CUE_HOLD_MS));

    await act(async () => {
      renderer.update(React.createElement(MobileNav, { open: false }));
    });
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS + ICON_CUE_HOLD_MS));
    expect(log).toEqual(['start', 'stop']);
    expect(mounts).toBe(1);

    await act(async () => renderer.unmount());
  });
});

describe('limpeza do grupo de deixas', () => {
  test('o unmount não deixa timer pendente', async () => {
    // Sem o `useEffect` de dispose em `useIconCueGroup`, os timers da deixa em
    // curso sobrevivem ao componente que os agendou.
    const clock = fakeClock();
    const log: string[] = [];
    const Icon = probeIcon(log);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(CuedNav, { signal: 0, scheduler: clock.schedule, icon: Icon }),
      );
    });
    await act(async () => {
      renderer.update(
        React.createElement(CuedNav, { signal: 1, scheduler: clock.schedule, icon: Icon }),
      );
    });

    // Deixa em curso: o `start` já disparou, o `stop` continua na fila.
    act(() => clock.advance(ICON_CUE_PANEL_DELAY_MS));
    expect(log).toEqual(['start']);
    expect(clock.pending()).toBe(1);

    await act(async () => renderer.unmount());
    expect(clock.pending()).toBe(0);

    act(() => clock.advance(10_000));
    expect(log).toEqual(['start']);
  });
});
