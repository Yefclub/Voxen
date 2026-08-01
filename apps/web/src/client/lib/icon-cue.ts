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

// ---------------------------------------------------------------------------
// Deixa de hover — o ícone E o controle que o contém
// ---------------------------------------------------------------------------

/**
 * Quem está pedindo a deixa de hover de um ícone.
 *
 * `icon` é o hover no glifo, que o próprio wrapper de `components/ui/icons`
 * reproduz. `control` é o hover no botão/link que contém o glifo, que chega
 * pela delegação abaixo. As duas áreas são sensíveis ao mesmo tempo, e é por
 * isso que existe uma trava em vez de dois pares soltos de start/stop.
 */
export type HoverCueSource = 'icon' | 'control';

/**
 * Trava de hover de um ícone: conta quantas fontes ainda enxergam o ponteiro
 * dentro e só toca o handle nas bordas.
 *
 * Sem ela o glifo dentro de um botão pisca: entrar no botão anima, entrar no
 * glifo reinicia a animação no meio, e sair do glifo — ainda dentro do botão —
 * derruba a animação com o ponteiro parado sobre o alvo de clique.
 */
export interface HoverCueLatch {
  enter: (source: HoverCueSource) => void;
  leave: (source: HoverCueSource) => void;
  /** Fontes que ainda enxergam o ponteiro dentro — diagnóstico e testes. */
  active: () => number;
}

export function createHoverCueLatch(handle: IconCueHandle): HoverCueLatch {
  const inside = new Set<HoverCueSource>();

  return {
    enter: (source) => {
      const wasIdle = inside.size === 0;
      inside.add(source);
      if (wasIdle) handle.startAnimation();
    },
    leave: (source) => {
      // `delete` devolve false para fonte que nunca entrou: um `leave` órfão
      // (ordem invertida de eventos, controle desmontando) não pode derrubar a
      // animação que a outra fonte ainda sustenta.
      if (!inside.delete(source)) return;
      if (inside.size === 0) handle.stopAnimation();
    },
    active: () => inside.size,
  };
}

/** Marca, no DOM, um ícone que aceita deixa de hover vinda do controle. */
export const ICON_CUE_ATTRIBUTE = 'data-icon-cue';

/**
 * Controles cujo hover anima os ícones que eles contêm.
 *
 * Cobre o alvo de clique de verdade — `<button>`, `<a>` (é o que `NavLink` e
 * `Link` renderizam), `<summary>` — e os papéis ARIA que o Radix usa nos
 * componentes em que o elemento não é um botão nativo.
 */
export const ICON_CUE_CONTROL_SELECTOR = [
  'button',
  'a',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
].join(',');

/**
 * Superfície mínima de DOM que a delegação usa. Existe para o teste poder
 * falsificar uma árvore sem `happy-dom`: `bun test` roda sem DOM neste repo.
 * `Element` satisfaz esta interface estruturalmente.
 */
export interface CueElement {
  closest: (selector: string) => CueElement | null;
  querySelectorAll: (selector: string) => Iterable<CueElement>;
  getAttribute: (name: string) => string | null;
}

export interface HoverScope {
  /** Registra a trava de um ícone e devolve o cancelamento. */
  register: (id: string, latch: HoverCueLatch) => () => void;
  /** Move o ponteiro para `target` — o elemento sob o mouse, ou nada. */
  pointTo: (target: CueElement | null) => void;
  /** Controle sob o ponteiro — diagnóstico e testes. */
  current: () => CueElement | null;
}

/**
 * Delegação de hover: um ponteiro, um controle por vez, N ícones dentro dele.
 *
 * Por que delegação e não uma prop em cada botão: o app tem 79 `<button>` cru,
 * 85 `<Button>` e uma pilha de `NavLink`/`Link`/itens de menu Radix. Amarrar a
 * deixa a um componente de botão deixaria de fora justamente a sidebar (que usa
 * `NavLink`), e amarrar em cada chamada seria uma mudança de centenas de
 * pontos que envelhece no primeiro botão novo que alguém escrever. Aqui o
 * ícone se anuncia por atributo e o escopo acha o controle subindo o DOM, então
 * qualquer controle passa a valer sem tocar em nada.
 *
 * Hover aninhado não dispara duas vezes: `closest` para no controle MAIS
 * PRÓXIMO, então um ícone dentro de um botão dentro de um card responde só ao
 * botão, e o `pointTo` só age quando o controle MUDA.
 */
export function createHoverScope(): HoverScope {
  const latches = new Map<string, HoverCueLatch>();
  let control: CueElement | null = null;
  // As travas que RECEBERAM `enter` no controle atual, guardadas por referência.
  // Não dá para redescobri-las no leave varrendo o DOM de novo: entre o enter e
  // o leave o ícone pode ter saído da subárvore do controle, ou a trava daquele
  // `data-icon-cue` pode ter sido substituída — nos dois casos a varredura
  // devolveria outra coisa e a trava que animou nunca receberia o `leave`,
  // deixando o ícone parado na pose animada.
  let entered: HoverCueLatch[] = [];

  const latchesIn = (root: CueElement): HoverCueLatch[] => {
    const found: HoverCueLatch[] = [];
    for (const node of root.querySelectorAll(`[${ICON_CUE_ATTRIBUTE}]`)) {
      const latch = latches.get(node.getAttribute(ICON_CUE_ATTRIBUTE) ?? '');
      if (latch) found.push(latch);
    }
    return found;
  };

  const pointTo = (target: CueElement | null): void => {
    const next = target?.closest(ICON_CUE_CONTROL_SELECTOR) ?? null;
    if (next === control) return;

    // Trocar de controle solta só o que o controle NOVO não contém. Controles
    // aninhados (botão dentro de card clicável) compartilham o mesmo ícone:
    // soltar tudo e reanimar em seguida faria o ícone piscar ao mover do botão
    // para a borda do card, com o ponteiro nunca tendo saído de cima dele.
    //
    // O que este diff NÃO resolve, para quem escrever o primeiro card clicável
    // com ação dentro: `latchesIn` varre a subárvore inteira, sem descontar o
    // que pertence a um controle interno. Entrar no botão de dentro solta os
    // ícones IRMÃOS do card e os reanima ao sair — o ponteiro nunca deixou o
    // card, então o CSS considera os dois hoverados e a deixa não. Hoje não há
    // instância disso no app; corrigir na frente exige o conjunto de ícones do
    // controle descontar os dos controles internos.
    const entering = next ? latchesIn(next) : [];
    const keep = new Set(entering);
    for (const latch of entered) if (!keep.has(latch)) latch.leave('control');
    control = next;
    entered = entering;
    for (const latch of entering) latch.enter('control');
  };

  const register = (id: string, latch: HoverCueLatch): (() => void) => {
    latches.set(id, latch);
    return () => {
      // Só remove o registro se ainda for o mesmo: em StrictMode o efeito roda
      // duas vezes e a limpeza do primeiro ciclo chega depois do registro do
      // segundo, com a MESMA chave. Apagar às cegas deixaria o ícone fora da
      // delegação para sempre.
      if (latches.get(id) === latch) latches.delete(id);
      // Trava desregistrada não fica pendurada esperando um `leave` que não tem
      // mais ícone do outro lado.
      entered = entered.filter((item) => item !== latch);
    };
  };

  return { register, pointTo, current: () => control };
}

/** Escopo único do app — um ponteiro, um escopo. */
const appHoverScope = createHoverScope();

/**
 * O escopo em que todo ícone montado se registra.
 *
 * Exposto para teste: é o que permite montar o wrapper de ícone de verdade e
 * conferir que ele entrou na delegação, em vez de inspecionar a fonte.
 */
export function iconHoverScope(): HoverScope {
  return appHoverScope;
}

/** O que a delegação lê de um evento de ponteiro. `PointerEvent` satisfaz. */
export interface DelegatedPointerEvent {
  target: unknown;
  relatedTarget: unknown;
  pointerType?: string;
}

/** Assina um tipo de evento de ponteiro. Em produção, `document`. */
export type PointerSubscribe = (
  type: 'pointerover' | 'pointerout',
  handler: (event: DelegatedPointerEvent) => void,
) => void;

/**
 * Aceita como origem da deixa só o que sabe subir o DOM.
 *
 * Duck-typing e não `instanceof Element` de propósito: é a mesma checagem em
 * produção e em teste (`bun test` roda sem DOM, então não existe `Element` para
 * comparar), o que mantém o guard sob cobertura em vez de virar linha morta.
 */
function asCueElement(target: unknown): CueElement | null {
  const candidate = target as CueElement | null | undefined;
  return candidate && typeof candidate.closest === 'function' ? candidate : null;
}

/**
 * Liga um escopo de hover a uma fonte de eventos de ponteiro.
 *
 * `pointerover`/`pointerout` (que borbulham) em vez de `mouseenter`/`mouseleave`
 * (que não): é o que permite um único par de ouvintes cobrir a árvore inteira,
 * inclusive o que é renderizado em portal (diálogo, dropdown, tooltip).
 *
 * Ponteiro de toque é ignorado. O browser emite a sequência de compatibilidade
 * no tap e só emite a saída no toque SEGUINTE em outro elemento: sem este
 * filtro, tocar numa aba da bottom-nav deixaria o ícone parado na pose animada
 * até o próximo toque em outro controle. Caneta continua valendo — ela tem
 * hover de verdade.
 */
export function bindHoverDelegation(scope: HoverScope, subscribe: PointerSubscribe): void {
  const hovers = (event: DelegatedPointerEvent): boolean => event.pointerType !== 'touch';

  subscribe('pointerover', (event) => {
    if (!hovers(event)) return;
    scope.pointTo(asCueElement(event.target));
  });

  // Ponteiro saindo da janela não gera `pointerover` em lugar nenhum; sem isto
  // o último controle hoverado ficaria animado até o mouse voltar.
  subscribe('pointerout', (event) => {
    if (!hovers(event)) return;
    if (!event.relatedTarget) scope.pointTo(null);
  });
}

/**
 * Envolve `bindHoverDelegation` para ligar uma vez só, por mais vezes que seja
 * chamado — todo ícone que monta chama, e são 102 no app.
 */
export function createPointerBinder(scope: HoverScope, subscribe: PointerSubscribe): () => void {
  let bound = false;
  return () => {
    if (bound) return;
    bound = true;
    bindHoverDelegation(scope, subscribe);
  };
}

const documentSubscribe: PointerSubscribe = (type, handler) => {
  // Sem DOM (render de servidor, `bun test`) não há o que assinar.
  if (typeof document === 'undefined') return;
  // Captura para pegar o evento mesmo se alguém interromper a propagação;
  // passivo porque a delegação nunca cancela. Ninguém remove os ouvintes — são
  // um par só, vivo enquanto a aba viver, e o custo é um `closest` por
  // transição de elemento, não por pixel percorrido.
  document.addEventListener(type, handler, { capture: true, passive: true });
};

const bindAppPointerDelegation = createPointerBinder(appHoverScope, documentSubscribe);

/**
 * Coloca um ícone na delegação de hover do app e devolve o cancelamento.
 * Chamado pelo wrapper de `components/ui/icons` — não use direto.
 */
export function registerIconHoverCue(id: string, latch: HoverCueLatch): () => void {
  bindAppPointerDelegation();
  return appHoverScope.register(id, latch);
}
