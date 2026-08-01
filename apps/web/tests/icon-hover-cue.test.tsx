import { createElement, forwardRef, useImperativeHandle, type MouseEvent } from 'react';
import { describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ICON_CUE_ATTRIBUTE,
  ICON_CUE_CONTROL_SELECTOR,
  bindHoverDelegation,
  createHoverCueLatch,
  createHoverScope,
  createPointerBinder,
  iconHoverScope,
  type CueElement,
  type DelegatedPointerEvent,
  type IconCueHandle,
  type PointerSubscribe,
} from '../src/client/lib/icon-cue';
import {
  accessibleIcon,
  type AnimatedIcon,
  type AnimatedIconProps,
} from '../src/client/components/ui/icons';

// `bun test` roda sem DOM neste repositório, então a delegação é exercitada
// contra uma árvore falsa que implementa só o que ela usa (`CueElement`), e o
// wrapper de ícone é montado com `react-test-renderer` — o mesmo par que
// `icon-cue-lifecycle` usa para travar o ciclo de vida das deixas.
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** Handle sonda: anota cada `start`/`stop` que recebe. */
function probeHandle(log: string[]): IconCueHandle {
  return {
    startAnimation: () => log.push('start'),
    stopAnimation: () => log.push('stop'),
  };
}

// ---------------------------------------------------------------------------
// Árvore falsa: `<root><control><icon/></control><outside/></root>`
// ---------------------------------------------------------------------------

interface FakeNode extends CueElement {
  cueId?: string;
  tag: string;
  role?: string;
  parent: FakeNode | null;
  children: FakeNode[];
  /** Quantas varreduras por ícone este nó recebeu — ver o teste de rescan. */
  scans: number;
}

/**
 * Casa um nó contra UM item do seletor. Entende as duas formas que
 * `ICON_CUE_CONTROL_SELECTOR` usa — nome de elemento e `[role="..."]` — para o
 * conteúdo do seletor ser exercitado de verdade: tirar `a` da lista tem de
 * quebrar o teste do link, não passar despercebido.
 */
function matchesOne(node: FakeNode, part: string): boolean {
  const role = /^\[role="(.+)"\]$/.exec(part);
  if (role) return node.role === role[1];
  // Um seletor composto (`button:not([disabled])`, `[data-slot="x"]`) casaria
  // no browser e não aqui: falhar alto é melhor que a árvore falsa divergir do
  // DOM real em silêncio.
  if (!/^[a-z]+$/.test(part)) throw new Error(`a árvore falsa não entende "${part}"`);
  return node.tag === part;
}

/** Desprende um nó do pai — simula o DOM mudando sob o ponteiro parado. */
function detach(child: FakeNode): void {
  const parent = child.parent;
  if (!parent) return;
  parent.children = parent.children.filter((node) => node !== child);
  child.parent = null;
}

function node(options: { tag?: string; role?: string; cueId?: string } = {}): FakeNode {
  const self: FakeNode = {
    cueId: options.cueId,
    tag: options.tag ?? 'div',
    role: options.role,
    parent: null,
    children: [],
    scans: 0,
    closest: (selector) => {
      const parts = selector.split(',').map((part) => part.trim());
      for (let at: FakeNode | null = self; at; at = at.parent) {
        if (parts.some((part) => matchesOne(at, part))) return at;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector !== `[${ICON_CUE_ATTRIBUTE}]`)
        throw new Error(`seletor inesperado: ${selector}`);
      self.scans += 1;
      const found: FakeNode[] = [];
      const walk = (from: FakeNode): void => {
        for (const child of from.children) {
          if (child.cueId !== undefined) found.push(child);
          walk(child);
        }
      };
      walk(self);
      return found;
    },
    getAttribute: (name) => (name === ICON_CUE_ATTRIBUTE ? (self.cueId ?? null) : null),
  };
  return self;
}

function adopt(parent: FakeNode, ...children: FakeNode[]): FakeNode {
  for (const child of children) {
    child.parent = parent;
    parent.children.push(child);
  }
  return parent;
}

/** Controle padrão dos testes: um `<button>`. */
const control = (): FakeNode => node({ tag: 'button' });

describe('trava de hover do ícone', () => {
  test('a segunda fonte a entrar não reinicia a animação', () => {
    // Entrar no botão e depois no glifo é o caminho normal do ponteiro. Sem a
    // trava, o segundo `enter` reiniciaria o desenho no meio.
    const log: string[] = [];
    const latch = createHoverCueLatch(probeHandle(log));

    latch.enter('control');
    latch.enter('icon');

    expect(log).toEqual(['start']);
    expect(latch.active()).toBe(2);
  });

  test('sair do glifo dentro do controle não derruba a animação', () => {
    // O defeito que a trava existe para impedir: o ponteiro continua sobre o
    // alvo de clique, então a animação continua.
    const log: string[] = [];
    const latch = createHoverCueLatch(probeHandle(log));

    latch.enter('control');
    latch.enter('icon');
    latch.leave('icon');
    expect(log).toEqual(['start']);

    latch.leave('control');
    expect(log).toEqual(['start', 'stop']);
    expect(latch.active()).toBe(0);
  });

  test('o glifo sozinho continua animando e parando', () => {
    // Ícone que não vive dentro de controle nenhum: a área do glifo segue
    // sensível, que é o requisito de não-regressão da spec 130.
    const log: string[] = [];
    const latch = createHoverCueLatch(probeHandle(log));

    latch.enter('icon');
    latch.leave('icon');

    expect(log).toEqual(['start', 'stop']);
  });

  test('um `leave` de fonte que nunca entrou é ignorado', () => {
    const log: string[] = [];
    const latch = createHoverCueLatch(probeHandle(log));

    latch.enter('control');
    latch.leave('icon');

    expect(log).toEqual(['start']);
    expect(latch.active()).toBe(1);
  });
});

describe('delegação de hover pelo controle', () => {
  test('entrar no controle anima o ícone que ele contém', () => {
    const log: string[] = [];
    const scope = createHoverScope();
    const icon = node({ cueId: 'a' });
    const button = adopt(control(), icon);
    const root = adopt(node(), button, node());
    scope.register('a', createHoverCueLatch(probeHandle(log)));

    scope.pointTo(button);
    expect(log).toEqual(['start']);
    expect(scope.current()).toBe(button);

    scope.pointTo(root.children[1] ?? null);
    expect(log).toEqual(['start', 'stop']);
    expect(scope.current()).toBeNull();
  });

  test('mover dentro do mesmo controle não redispara nem revarre o DOM', () => {
    // `mouseover` borbulha e dispara a cada transição de elemento dentro do
    // botão — texto, ícone, span. Sem a checagem de mudança em `pointTo`, cada
    // passo do ponteiro custaria um `querySelectorAll` no controle inteiro.
    const log: string[] = [];
    const scope = createHoverScope();
    const icon = node({ cueId: 'a' });
    const rotulo = node({ tag: 'span' });
    const button = adopt(control(), icon, rotulo);
    adopt(node(), button);
    scope.register('a', createHoverCueLatch(probeHandle(log)));

    scope.pointTo(button);
    scope.pointTo(icon);
    scope.pointTo(rotulo);
    scope.pointTo(button);

    expect(log).toEqual(['start']);
    expect(button.scans).toBe(1);
  });

  test('link e item de menu também são controles', () => {
    // A sidebar inteira é `NavLink` (`<a>`), e os menus do Radix marcam o item
    // com `role="menuitem"` em vez de `<button>`. Tirar qualquer um dos dois do
    // seletor apagaria a deixa por controle nessas superfícies em silêncio.
    for (const alvo of [node({ tag: 'a' }), node({ tag: 'div', role: 'menuitem' })]) {
      const log: string[] = [];
      const scope = createHoverScope();
      const controle = adopt(alvo, node({ cueId: 'a' }));
      adopt(node(), controle);
      scope.register('a', createHoverCueLatch(probeHandle(log)));

      scope.pointTo(controle);

      expect(scope.current()).toBe(controle);
      expect(log).toEqual(['start']);
    }
  });

  test('o seletor de controle é uma lista de seletores válida', () => {
    // Guarda barata contra vírgula perdida num refactor da lista: um item vazio
    // faria `closest` lançar `SyntaxError` no browser, e a delegação inteira
    // morreria no primeiro movimento do mouse.
    const parts = ICON_CUE_CONTROL_SELECTOR.split(',');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.trim()).not.toBe('');
  });

  test('hover aninhado anima uma vez e não pisca ao trocar de controle', () => {
    // Ícone dentro de botão dentro de card clicável. `closest` para no botão,
    // então entrar é UM disparo, não dois. E mover do botão para a borda do
    // card — que também contém o ícone — não pode soltar e reanimar: o
    // ponteiro nunca saiu de cima do ícone.
    const log: string[] = [];
    const scope = createHoverScope();
    const icon = node({ cueId: 'a' });
    const button = adopt(control(), icon);
    const card = adopt(control(), button);
    const root = adopt(node(), card, node());
    scope.register('a', createHoverCueLatch(probeHandle(log)));

    scope.pointTo(icon);
    expect(scope.current()).toBe(button);
    expect(log).toEqual(['start']);

    scope.pointTo(card);
    expect(scope.current()).toBe(card);
    expect(log).toEqual(['start']);

    scope.pointTo(root.children[1] ?? null);
    expect(log).toEqual(['start', 'stop']);
  });

  test('todos os ícones do controle animam juntos', () => {
    const first: string[] = [];
    const second: string[] = [];
    const scope = createHoverScope();
    const button = adopt(control(), node({ cueId: 'a' }), node({ cueId: 'b' }));
    adopt(node(), button);
    scope.register('a', createHoverCueLatch(probeHandle(first)));
    scope.register('b', createHoverCueLatch(probeHandle(second)));

    scope.pointTo(button);

    expect(first).toEqual(['start']);
    expect(second).toEqual(['start']);
  });

  test('ícone fora de qualquer controle não é tocado pela delegação', () => {
    const log: string[] = [];
    const scope = createHoverScope();
    const icon = node({ cueId: 'a' });
    adopt(node(), icon);
    scope.register('a', createHoverCueLatch(probeHandle(log)));

    scope.pointTo(icon);

    expect(scope.current()).toBeNull();
    expect(log).toEqual([]);
  });

  test('o ícone que sai da subárvore do controle não fica preso animado', () => {
    // A árvore não é estática: um ícone pode sair de dentro do controle entre o
    // enter e o leave (troca de estado que reordena o conteúdo do botão). Como
    // `latchesIn` reconsulta o DOM na hora do leave, o ícone que já não está lá
    // nunca receberia `leave('control')` e ficaria parado na pose animada.
    const log: string[] = [];
    const scope = createHoverScope();
    const icon = node({ cueId: 'a' });
    const button = adopt(control(), icon);
    const root = adopt(node(), button, node());
    scope.register('a', createHoverCueLatch(probeHandle(log)));

    scope.pointTo(button);
    expect(log).toEqual(['start']);

    detach(icon);
    adopt(root, icon);
    scope.pointTo(root.children[1] ?? null);

    expect(log).toEqual(['start', 'stop']);
  });

  test('o ícone desregistrado sai da delegação', () => {
    const log: string[] = [];
    const scope = createHoverScope();
    const button = adopt(control(), node({ cueId: 'a' }));
    adopt(node(), button);
    const unregister = scope.register('a', createHoverCueLatch(probeHandle(log)));

    unregister();
    scope.pointTo(button);

    expect(log).toEqual([]);
  });

  test('trocar a trava sob a mesma chave não deixa a antiga presa animada', () => {
    // O ícone recria a trava quando o gate de movimento muda. Se isso acontece
    // com o ponteiro dentro do controle, a trava que já chamou `start` some do
    // mapa — e sem guardar quem entrou, ela nunca receberia o `stop`.
    const antiga: string[] = [];
    const nova: string[] = [];
    const scope = createHoverScope();
    const button = adopt(control(), node({ cueId: 'a' }));
    const root = adopt(node(), button, node());
    scope.register('a', createHoverCueLatch(probeHandle(antiga)));

    scope.pointTo(button);
    expect(antiga).toEqual(['start']);

    scope.register('a', createHoverCueLatch(probeHandle(nova)));
    scope.pointTo(root.children[1] ?? null);

    expect(antiga).toEqual(['start', 'stop']);
    expect(nova).toEqual([]);
  });

  test('a limpeza tardia de um registro substituído não desliga o ícone', () => {
    // StrictMode roda o efeito duas vezes: a limpeza do primeiro ciclo chega
    // DEPOIS do registro do segundo, com a mesma chave. Apagar às cegas tiraria
    // o ícone da delegação para sempre.
    const log: string[] = [];
    const scope = createHoverScope();
    const button = adopt(control(), node({ cueId: 'a' }));
    adopt(node(), button);

    const staleCleanup = scope.register('a', createHoverCueLatch(probeHandle([])));
    scope.register('a', createHoverCueLatch(probeHandle(log)));
    staleCleanup();

    scope.pointTo(button);
    expect(log).toEqual(['start']);
  });
});

// ---------------------------------------------------------------------------
// Wrapper real de ícone: as duas áreas sensíveis, no mesmo componente
// ---------------------------------------------------------------------------

/** Ícone sonda no lugar do ícone do pacote — devolve o que o wrapper passou. */
function probeIcon(log: string[]): {
  Icon: AnimatedIcon;
  seen: () => AnimatedIconProps;
} {
  let latest: AnimatedIconProps | null = null;

  const Probe = forwardRef<IconCueHandle, AnimatedIconProps>(function Probe(props, ref) {
    latest = props;
    useImperativeHandle(ref, () => probeHandle(log), []);
    return null;
  });

  return {
    Icon: accessibleIcon(Probe as AnimatedIcon),
    seen: () => {
      if (!latest) throw new Error('o wrapper não renderizou o ícone interno');
      return latest;
    },
  };
}

// ---------------------------------------------------------------------------
// A ponta que fala com o browser
// ---------------------------------------------------------------------------

/** Fonte de eventos falsa: guarda os handlers e deixa o teste dispará-los. */
function pointerSource(): {
  subscribe: PointerSubscribe;
  fire: (type: 'pointerover' | 'pointerout', event: Partial<DelegatedPointerEvent>) => void;
  count: (type: 'pointerover' | 'pointerout') => number;
} {
  const handlers = new Map<string, ((event: DelegatedPointerEvent) => void)[]>();
  return {
    subscribe: (type, handler) => {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    fire: (type, event) => {
      for (const handler of handlers.get(type) ?? []) {
        handler({ target: null, relatedTarget: null, ...event });
      }
    },
    count: (type) => (handlers.get(type) ?? []).length,
  };
}

describe('ligação da delegação com o ponteiro', () => {
  test('mover o ponteiro entre controles anima e solta', () => {
    const log: string[] = [];
    const scope = createHoverScope();
    const source = pointerSource();
    const button = adopt(control(), node({ cueId: 'a' }));
    const root = adopt(node(), button, node());
    scope.register('a', createHoverCueLatch(probeHandle(log)));
    bindHoverDelegation(scope, source.subscribe);

    source.fire('pointerover', { target: button, pointerType: 'mouse' });
    expect(log).toEqual(['start']);

    source.fire('pointerover', { target: root.children[1], pointerType: 'mouse' });
    expect(log).toEqual(['start', 'stop']);
  });

  test('o ponteiro saindo da janela solta o controle', () => {
    // `pointerout` sem `relatedTarget` é a única pista de que o ponteiro deixou
    // o documento — não vem `pointerover` em lugar nenhum depois disso.
    const log: string[] = [];
    const scope = createHoverScope();
    const source = pointerSource();
    const button = adopt(control(), node({ cueId: 'a' }));
    adopt(node(), button);
    scope.register('a', createHoverCueLatch(probeHandle(log)));
    bindHoverDelegation(scope, source.subscribe);

    source.fire('pointerover', { target: button, pointerType: 'mouse' });
    // Saída para outro elemento do documento não é saída da janela.
    source.fire('pointerout', { target: button, relatedTarget: button, pointerType: 'mouse' });
    expect(log).toEqual(['start']);

    source.fire('pointerout', { target: button, relatedTarget: null, pointerType: 'mouse' });
    expect(log).toEqual(['start', 'stop']);
  });

  test('toque não aciona a deixa', () => {
    // No tap o browser emite a sequência de compatibilidade e só emite a saída
    // no toque SEGUINTE em outro elemento — o ícone ficaria parado na pose
    // animada até lá. Caneta continua valendo: ela tem hover de verdade.
    const scope = createHoverScope();
    const source = pointerSource();
    const button = adopt(control(), node({ cueId: 'a' }));
    adopt(node(), button);
    bindHoverDelegation(scope, source.subscribe);

    const toque: string[] = [];
    scope.register('a', createHoverCueLatch(probeHandle(toque)));
    source.fire('pointerover', { target: button, pointerType: 'touch' });
    expect(toque).toEqual([]);
    expect(scope.current()).toBeNull();

    source.fire('pointerover', { target: button, pointerType: 'pen' });
    expect(toque).toEqual(['start']);
  });

  test('alvo que não sabe subir o DOM não vira controle', () => {
    // `document` e `window` também recebem os eventos e não têm `closest`.
    const scope = createHoverScope();
    const source = pointerSource();
    const button = adopt(control(), node({ cueId: 'a' }));
    adopt(node(), button);
    const log: string[] = [];
    scope.register('a', createHoverCueLatch(probeHandle(log)));
    bindHoverDelegation(scope, source.subscribe);

    source.fire('pointerover', { target: button, pointerType: 'mouse' });
    source.fire('pointerover', { target: { nodeName: '#document' }, pointerType: 'mouse' });

    expect(scope.current()).toBeNull();
    expect(log).toEqual(['start', 'stop']);
  });

  test('a ligação acontece uma vez só, por mais ícones que montem', () => {
    const scope = createHoverScope();
    const source = pointerSource();
    const bind = createPointerBinder(scope, source.subscribe);

    bind();
    bind();
    bind();

    expect(source.count('pointerover')).toBe(1);
    expect(source.count('pointerout')).toBe(1);
  });
});

/** Botão falso contendo o ícone que o wrapper montado marcou no DOM. */
function buttonAround(cueId: string): FakeNode {
  const button = adopt(control(), node({ cueId }));
  adopt(node(), button, node());
  return button;
}

const hover = {} as MouseEvent<HTMLDivElement>;

describe('ícone montado: glifo e controle', () => {
  test('montar o ícone o coloca na delegação do app', async () => {
    // Percurso inteiro, sem atalho: o wrapper real monta, escreve a própria
    // marca no ícone interno e se registra no escopo do app. Apontar o
    // ponteiro para o BOTÃO — nunca para o glifo — anima o ícone.
    const log: string[] = [];
    const { Icon, seen } = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Icon));
    });

    const cueId = seen()[ICON_CUE_ATTRIBUTE];
    expect(typeof cueId).toBe('string');
    expect(cueId).not.toBe('');

    const scope = iconHoverScope();
    const button = buttonAround(cueId ?? '');

    act(() => scope.pointTo(button));
    expect(log).toEqual(['start']);

    act(() => scope.pointTo(button.parent?.children[1] ?? null));
    expect(log).toEqual(['start', 'stop']);

    await act(async () => renderer.unmount());
  });

  test('o hover pelo glifo continua animando', async () => {
    // Requisito de não-regressão da spec 130: estender o disparo ao controle
    // não pode custar o disparo pelo próprio ícone.
    const log: string[] = [];
    const { Icon, seen } = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Icon));
    });

    act(() => {
      seen().onMouseEnter?.(hover);
      seen().onMouseLeave?.(hover);
    });
    expect(log).toEqual(['start', 'stop']);

    await act(async () => renderer.unmount());
  });

  test('sair do glifo com o ponteiro ainda no botão não para a animação', async () => {
    // O caminho real do ponteiro atravessa as duas áreas. É aqui que a trava
    // prova o valor: sem ela o `mouseleave` do glifo derrubaria a animação com
    // o mouse parado sobre o alvo de clique.
    const log: string[] = [];
    const { Icon, seen } = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Icon));
    });

    const scope = iconHoverScope();
    const button = buttonAround(seen()[ICON_CUE_ATTRIBUTE] ?? '');

    act(() => scope.pointTo(button));
    act(() => seen().onMouseEnter?.(hover));
    act(() => seen().onMouseLeave?.(hover));
    expect(log).toEqual(['start']);

    act(() => scope.pointTo(null));
    expect(log).toEqual(['start', 'stop']);

    await act(async () => renderer.unmount());
  });

  test('desmontar o ícone o tira da delegação', async () => {
    const log: string[] = [];
    const { Icon, seen } = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Icon));
    });
    const button = buttonAround(seen()[ICON_CUE_ATTRIBUTE] ?? '');
    await act(async () => renderer.unmount());

    act(() => iconHoverScope().pointTo(button));
    expect(log).toEqual([]);
  });

  test('ligar movimento reduzido no meio da sessão silencia o ícone já montado', async () => {
    // A trava é criada uma vez por montagem e lê o gate por ref. Congelar o
    // valor da montagem deixaria o ícone animando depois de o usuário pedir
    // movimento reduzido — e, no sentido inverso, mudo para sempre.
    const log: string[] = [];
    const { Icon, seen } = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Icon, { isAnimated: true }));
    });
    const scope = iconHoverScope();
    const button = buttonAround(seen()[ICON_CUE_ATTRIBUTE] ?? '');

    act(() => scope.pointTo(button));
    expect(log).toEqual(['start']);
    act(() => scope.pointTo(null));
    log.length = 0;

    await act(async () => {
      renderer.update(createElement(Icon, { isAnimated: false }));
    });

    act(() => scope.pointTo(button));
    act(() => seen().onMouseEnter?.(hover));
    expect(log).toEqual([]);

    act(() => scope.pointTo(null));
    await act(async () => renderer.unmount());
  });

  test('movimento reduzido não anima nem por controle nem por glifo', async () => {
    // `isAnimated={false}` é o mesmo gate que `prefers-reduced-motion` usa
    // (`shouldAnimateDecoration`), e ele tem de fechar as DUAS áreas.
    const log: string[] = [];
    const { Icon, seen } = probeIcon(log);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Icon, { isAnimated: false }));
    });

    const scope = iconHoverScope();
    const button = buttonAround(seen()[ICON_CUE_ATTRIBUTE] ?? '');

    act(() => scope.pointTo(button));
    act(() => seen().onMouseEnter?.(hover));
    expect(log).toEqual([]);

    act(() => scope.pointTo(null));
    await act(async () => renderer.unmount());
  });
});
