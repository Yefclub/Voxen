import { describe, expect, test } from 'bun:test';
import {
  createElement,
  forwardRef,
  useImperativeHandle,
  type MouseEvent,
  type Ref,
  type RefObject,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accessibleIcon, type AnimatedIconProps } from './icons';
import { shouldAnimateDecoration } from '../../lib/interface-foundation';
import type { IconCueHandle } from '../../lib/icon-cue';

/**
 * Renderiza o wrapper de ícone com uma sonda no lugar do ícone do pacote e
 * devolve o que chegou nela. Renderização de servidor: sem DOM, sem efeitos —
 * o suficiente para inspecionar o contrato de props entre wrapper e ícone.
 */
function renderProbe(props: AnimatedIconProps = {}): {
  props: AnimatedIconProps;
  ref: Ref<IconCueHandle> | null;
} {
  let seen: AnimatedIconProps | null = null;
  let seenRef: Ref<IconCueHandle> | null = null;

  const Probe = forwardRef<IconCueHandle, AnimatedIconProps>(function Probe(probeProps, ref) {
    seen = probeProps;
    seenRef = ref;
    useImperativeHandle(ref, () => ({ startAnimation: () => {}, stopAnimation: () => {} }), []);
    return createElement('span');
  });

  renderToStaticMarkup(createElement(accessibleIcon(Probe), props));
  if (!seen) throw new Error('o wrapper não renderizou o ícone interno');
  return { props: seen, ref: seenRef };
}

const mouseEvent = {} as MouseEvent<HTMLDivElement>;

describe('wrapper de ícone animado', () => {
  test('anexa o handle de animação ao ícone interno', () => {
    // É o que as deixas de `lib/icon-cue` usam para desenhar o ícone.
    expect(renderProbe().ref).not.toBeNull();
  });

  test('reproduz o hover que a ref desliga', () => {
    // Com uma ref anexada o pacote para de animar o hover sozinho e passa a
    // delegar. Sem estes handlers, os 102 ícones do app perdem o hover em
    // silêncio — é a regressão que este teste existe para travar.
    const { props } = renderProbe();

    expect(typeof props.onMouseEnter).toBe('function');
    expect(typeof props.onMouseLeave).toBe('function');
  });

  test('o hover reproduzido anima o ícone interno', () => {
    // Manter os handlers e esvaziá-los é a variante mais provável num
    // refactor — e é exatamente a regressão dos 102 ícones. O `ref` devolvido
    // pela sonda é o `inner` do wrapper; em render de servidor o
    // `useImperativeHandle` da sonda não roda, então o handle é escrito à mão
    // para observar o que os handlers fazem com ele.
    const calls: string[] = [];
    const { props, ref } = renderProbe();
    (ref as RefObject<IconCueHandle | null>).current = {
      startAnimation: () => calls.push('start'),
      stopAnimation: () => calls.push('stop'),
    };

    props.onMouseEnter?.(mouseEvent);
    props.onMouseLeave?.(mouseEvent);

    expect(calls).toEqual(['start', 'stop']);
  });

  test('compõe com os handlers de mouse de quem usa o ícone', () => {
    const calls: string[] = [];
    const { props } = renderProbe({
      onMouseEnter: () => calls.push('enter'),
      onMouseLeave: () => calls.push('leave'),
    });

    props.onMouseEnter?.(mouseEvent);
    props.onMouseLeave?.(mouseEvent);

    expect(calls).toEqual(['enter', 'leave']);
  });

  test('não anima o ícone quando quem o usa pede estático', () => {
    expect(renderProbe({ isAnimated: false }).props.isAnimated).toBe(false);
  });

  test('o estado animado passa pelo gate de movimento reduzido', () => {
    // O valor efetivo de `isAnimated` depende de `prefers-reduced-motion`, que
    // não existe fora do browser; o gate em si é determinístico e é o que
    // garante o requisito de movimento reduzido na camada do ícone.
    expect(shouldAnimateDecoration(true, true)).toBe(false);
    expect(shouldAnimateDecoration(null, true)).toBe(true);
    expect(shouldAnimateDecoration(null, false)).toBe(false);
  });

  test('mantém o frame do ícone ao mesclar a classe recebida', () => {
    const { props } = renderProbe({ className: 'h-4 w-4' });

    expect(props.className).toContain('h-4 w-4');
    expect(props.className).toContain('shrink-0');
  });
});
