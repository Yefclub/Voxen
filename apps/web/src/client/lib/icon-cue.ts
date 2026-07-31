import { useCallback, useEffect, useRef, useState } from 'react';

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
 * os alvos são menores, e um atraso inicial curto para o ícone não largar junto
 * com o container.
 */
export const ICON_CUE_DURATION = 0.55;
export const ICON_CUE_STAGGER_MS = 45;
/** Tempo em estado animado antes de voltar ao repouso — cobre o desenho todo. */
export const ICON_CUE_HOLD_MS = 900;
/**
 * Atraso da deixa da página. Curto de propósito: o ícone entra com o cabeçalho
 * ainda subindo (a timeline do `PageShell` leva 0.38s), sobrepondo os dois
 * gestos. São elementos e propriedades diferentes — o cabeçalho move `y` e
 * `opacity` do bloco, o ícone desenha o próprio traço — então não há
 * concorrência nem salto de layout, só um gesto começando dentro do outro.
 */
export const ICON_CUE_PAGE_DELAY_MS = 120;
/**
 * Atraso da deixa da sidebar. Também sobreposto: o painel entra por spring e a
 * varredura dos ícones começa enquanto ele ainda desliza, o suficiente para o
 * primeiro ícone não nascer no mesmo frame do container.
 */
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

/**
 * Agenda `run` para daqui a `delayMs` e devolve o cancelador.
 *
 * A fila recebe o agendador por parâmetro em vez de chamar `setTimeout` direto:
 * é o que permite testar agendamento, cancelamento e vazamento com um relógio
 * falso, sem DOM e sem depender de timers reais.
 */
export type CueScheduler = (run: () => void, delayMs: number) => () => void;

export const timeoutScheduler: CueScheduler = (run, delayMs) => {
  const id = setTimeout(run, delayMs);
  return () => clearTimeout(id);
};

/** Uma tarefa da deixa: o que rodar e quando. */
export interface CueTask {
  at: number;
  run: () => void;
}

export interface CueQueue {
  /** Agenda as tarefas, cancelando qualquer deixa ainda pendente. */
  schedule: (tasks: readonly CueTask[]) => void;
  /** Cancela tudo o que ainda não disparou. */
  clearAll: () => void;
  /** Quantas tarefas seguem pendentes (diagnóstico e testes). */
  size: () => number;
}

/**
 * Fila de tarefas com prazo, com uma única deixa viva por vez.
 *
 * Os canceladores vivem em um `Map` interno criado uma vez pela fábrica, então
 * `clearAll` sempre enxerga a fila atual — não existe a classe de bug em que
 * uma referência antiga ao array segura timers já substituídos.
 */
export function createCueQueue(scheduler: CueScheduler = timeoutScheduler): CueQueue {
  const cancels = new Map<number, () => void>();
  let nextId = 0;

  const clearAll = (): void => {
    for (const cancel of cancels.values()) cancel();
    cancels.clear();
  };

  const schedule = (tasks: readonly CueTask[]): void => {
    clearAll();
    for (const task of tasks) {
      const id = nextId++;
      const cancel = scheduler(() => {
        cancels.delete(id);
        task.run();
      }, task.at);
      cancels.set(id, cancel);
    }
  };

  return { schedule, clearAll, size: () => cancels.size };
}

export interface IconCueGroup {
  /** Ref estável por chave — registra o ícone no grupo, na ordem de montagem. */
  registerIcon: (key: string) => (handle: IconCueHandle | null) => void;
  /** Roda a animação dos ícones registrados, em cascata. */
  playCue: (baseDelayMs?: number) => void;
}

export interface IconCueController {
  registerIcon: (key: string) => (handle: IconCueHandle | null) => void;
  /** Roda a cascata. `enabled` espelha `prefers-reduced-motion`. */
  play: (enabled: boolean, baseDelayMs?: number) => void;
  /** Cancela a deixa pendente — o grupo saiu da árvore. */
  dispose: () => void;
}

/**
 * Núcleo das deixas de ícone, sem React: registro dos handles + fila.
 *
 * Duas garantias que o React não dá de graça e que os testes travam:
 *
 * 1. `registerIcon(key)` devolve **sempre o mesmo setter** para a mesma chave.
 *    Uma ref-callback nova a cada render faz o React desanexar e reanexar o
 *    ref a cada ciclo, e o handle some no meio da deixa.
 * 2. O handle é resolvido **na hora do disparo**, não no agendamento. Um ícone
 *    que desmontou entre agendar e disparar (trocar de página, alternar a
 *    sidebar no meio da cascata) simplesmente não é animado — nenhum timer
 *    sobrevivente consegue tocar um ícone que já saiu.
 */
export function createIconCueController(
  scheduler: CueScheduler = timeoutScheduler,
): IconCueController {
  const handles = new Map<string, IconCueHandle>();
  const setters = new Map<string, (handle: IconCueHandle | null) => void>();
  const queue = createCueQueue(scheduler);

  const registerIcon = (key: string): ((handle: IconCueHandle | null) => void) => {
    const cached = setters.get(key);
    if (cached) return cached;

    const setter = (handle: IconCueHandle | null): void => {
      if (handle) handles.set(key, handle);
      else handles.delete(key);
    };
    setters.set(key, setter);
    return setter;
  };

  const play = (enabled: boolean, baseDelayMs = 0): void => {
    // Movimento reduzido não agenda nada — e ainda derruba a deixa em curso.
    // Fora desse caso quem limpa é o próprio `schedule`, na primeira linha:
    // limpar duas vezes só mascara regressão em quem só olha uma das chamadas.
    if (!enabled) {
      queue.clearAll();
      return;
    }

    const keys = [...handles.keys()];
    const steps = iconCueSchedule(keys.length, baseDelayMs);
    queue.schedule(
      keys.flatMap((key, index) => {
        const step = steps[index];
        if (!step) return [];
        return [
          { at: step.startAt, run: () => handles.get(key)?.startAnimation() },
          { at: step.stopAt, run: () => handles.get(key)?.stopAnimation() },
        ];
      }),
    );
  };

  return { registerIcon, play, dispose: queue.clearAll };
}

/**
 * Casca React do controlador acima: mantém uma instância por componente e
 * cancela a deixa pendente no unmount.
 *
 * `scheduler` existe para teste — é o que permite verificar, com relógio
 * falso, que o unmount não deixa timer pendente. Em produção ninguém passa.
 */
export function useIconCueGroup(
  enabled: boolean,
  scheduler: CueScheduler = timeoutScheduler,
): IconCueGroup {
  const ref = useRef<IconCueController | null>(null);
  ref.current ??= createIconCueController(scheduler);
  const controller = ref.current;

  useEffect(() => controller.dispose, [controller]);

  const playCue = useCallback(
    (baseDelayMs = 0) => controller.play(enabled, baseDelayMs),
    [controller, enabled],
  );

  return { registerIcon: controller.registerIcon, playCue };
}

/**
 * Roda a deixa toda vez que `signal` MUDA — nunca na montagem.
 *
 * É o gatilho da sidebar e do drawer mobile, que precisam pontuar em abrir e
 * fechar. Um booleano "anima ao montar" não serviria para os dois: a sidebar
 * desktop remonta rail e painel a cada toggle, enquanto o drawer mobile fica
 * montado o tempo todo (o gesto de swipe precisa dele pronto) e só desliza.
 * Um contador cobre os dois casos e, por só reagir a mudança, não pontua no
 * primeiro carregamento nem em painel que está saindo de cena.
 */
export function useIconCueSignal(
  playCue: (baseDelayMs?: number) => void,
  signal: number,
  baseDelayMs: number,
): void {
  const last = useRef(signal);

  useEffect(() => {
    if (signal === last.current) return;
    last.current = signal;
    playCue(baseDelayMs);
  }, [baseDelayMs, playCue, signal]);
}

/**
 * Produz o sinal que `useIconCueSignal` consome: um contador que avança a cada
 * MUDANÇA de `state`, nunca na montagem. É a ponta de disparo da navegação —
 * a sidebar desktop passa `collapsed`, o drawer mobile passa `open`.
 *
 * O incremento acontece **em um efeito**, e isso não é detalhe: ao alternar o
 * colapso, o painel (ou o rail) monta no mesmo commit em que `state` mudou e
 * captura em `useIconCueSignal` o sinal AINDA ANTIGO; o incremento cai no
 * commit seguinte, e é essa segunda passada que dispara a deixa. Derivar o
 * sinal durante o render — `const signal = collapsed ? 1 : 0`, por exemplo —
 * entrega o valor novo já na montagem, o hook não enxerga mudança nenhuma e a
 * deixa do desktop morre em silêncio: sem erro de tipo, sem tela quebrada.
 *
 * `punctuates` filtra quais estados pontuam — o corpo do drawer mobile nunca
 * desmonta e só quer pontuar ao abrir, porque varrer ícones de um painel que
 * está saindo de cena é desperdício. Precisa ser estável entre renders.
 */
export function useIconCueTrigger<T>(state: T, punctuates?: (state: T) => boolean): number {
  const [signal, setSignal] = useState(0);
  const previous = useRef(state);

  useEffect(() => {
    if (Object.is(previous.current, state)) return;
    previous.current = state;
    if (punctuates && !punctuates(state)) return;
    setSignal((current) => current + 1);
  }, [punctuates, state]);

  return signal;
}
